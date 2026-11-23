import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CheckResult,
  getNodeOp,
  getTaskOp,
  PROJECT_CHECK_PLACEHOLDER,
  ServerEventType,
  type TaskDetailDTO,
  TaskStatus,
  updateProjectOp,
  updateSettingsOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { addProject, createTask, finalVerify, planArgs } from '../../../test/helpers/tasks.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
  await t.call(updateSettingsOp, { 'node.maxAttempts': 1 });
});
afterEach(() => t.close());

const JAVA_TEST = 'src/test/java/demo/ExampleTest.java';
const OLD_TEST =
  'package demo; import org.junit.jupiter.api.Test; class ExampleTest { @Test void checksBaseline() {} }';
const EDITED_TEST = OLD_TEST.replace('checksBaseline', 'checksWorktreeEdit');
const MAVEN =
  '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>acceptance</artifactId><version>1</version><dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.11.0</version></dependency></dependencies></project>';
const GRADLE = 'plugins { java }\ndependencies { testImplementation("org.junit.jupiter:junit-jupiter:5.11.0") }';
const BACKUP =
  "node -e \"require('node:fs').writeFileSync('fallback-fired.txt', 'ran'); console.log('CONFIGURED BACKUP COMMAND')\"";

function wrapper(kind: 'maven' | 'gradle', status: number) {
  if (process.platform === 'win32') {
    return [
      '@echo off',
      `echo AUTOMATIC ${kind.toUpperCase()} %*`,
      `git diff --quiet HEAD -- "${JAVA_TEST}"`,
      'if not errorlevel 1 exit /b 90',
      `findstr /C:"checksWorktreeEdit" "${JAVA_TEST.replaceAll('/', '\\')}" >nul`,
      'if errorlevel 1 exit /b 91',
      `exit /b ${status}`,
      '',
    ].join('\r\n');
  }
  return `#!/bin/sh
printf 'AUTOMATIC ${kind.toUpperCase()} %s\n' "$*"
git diff --quiet HEAD -- "${JAVA_TEST}" && exit 90
grep -q checksWorktreeEdit "${JAVA_TEST}" || exit 91
exit ${status}
`;
}

function junit(name: string) {
  return `<configuration name="${name}" type="JUnit">
    <module name="acceptance"/>
    <option name="MAIN_CLASS_NAME" value="demo.ExampleTest"/>
    <option name="TEST_OBJECT" value="class"/>
  </configuration>`;
}

async function buildProject(kind: 'maven' | 'gradle', exitCode: number) {
  const windows = process.platform === 'win32';
  const launcher = kind === 'maven' ? (windows ? 'mvnw.cmd' : 'mvnw') : windows ? 'gradlew.bat' : 'gradlew';
  const { project, repo } = await addProject(t, {
    checkCommand: BACKUP,
    files: {
      ...(kind === 'maven' ? { 'pom.xml': MAVEN } : { 'build.gradle': GRADLE }),
      [JAVA_TEST]: OLD_TEST,
      [launcher]: wrapper(kind, exitCode),
    },
  });
  if (!windows) {
    await chmod(join(repo.path, launcher), 0o755);
    await repo.git('add', '--chmod=+x', launcher);
    await repo.git('commit', '-m', 'Mark the fixture launcher executable');
  }
  // 个人 IDEA 配置不在 Git 中，已登记的项目提供其测试入口。
  await mkdir(join(repo.path, '.idea'));
  await writeFile(
    join(repo.path, '.idea/workspace.xml'),
    `<project><component name="RunManager">${junit('Worktree acceptance')}</component></project>`,
  );
  return { project, repo };
}

async function runWorkflow(projectId: string, workflow: 'bugfix' | 'feature') {
  const finished = waitForEvent(
    t.app.events,
    ServerEventType.TaskUpdated,
    ({ project, status }) => project.id === projectId && (status === TaskStatus.Review || status === TaskStatus.Failed),
  );
  const task = await createTask(t, { projectId, workflow, requirement: '更新示例并验证' });
  await finished;
  return (await t.call(getTaskOp, { id: task.id })).body;
}

async function runFix(projectId: string, edits: Record<string, string>) {
  t.fake.enqueue(script().callTool('submit_result', { summary: 'Reproduced the bug' }), { title: '定位根因' });
  const fix = script();
  for (const [file, content] of Object.entries(edits)) fix.edit(file, content);
  fix.callTool('submit_result', { summary: 'Fixed the acceptance fixture' });
  t.fake.enqueue(fix, { title: '· 修复' });
  t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Looks right' }), {
    agent: 'aw-reviewer',
  });

  return runWorkflow(projectId, 'bugfix');
}

async function acceptance(task: TaskDetailDTO, nodeKey = 'fix'): Promise<CheckResult[]> {
  const fix = task.nodes.find(({ key }) => key === nodeKey);
  if (!fix) throw new Error('Expected fixed bug workflow');
  const { body } = await t.call(getNodeOp, { id: task.id, nodeId: fix.id });
  return body.checkResults ?? [];
}

describe('普通修复任务的自动验收', () => {
  it('调用 Maven 的 IDEA 选择并检查未提交的工作树内容', async () => {
    const { project, repo } = await buildProject('maven', 0);
    const task = await runFix(project.id, { [JAVA_TEST]: EDITED_TEST });
    expect(task.status).toBe(TaskStatus.Review);
    expect(await acceptance(task)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          passed: true,
          autoSelection: expect.objectContaining({ source: 'idea', configurations: ['Worktree acceptance'] }),
          output: expect.stringMatching(/AUTOMATIC MAVEN .*test.*demo\.ExampleTest/),
        }),
      ]),
    );
    expect(await readFile(join(repo.path, JAVA_TEST), 'utf8')).toBe(OLD_TEST);
  });

  it('保留 Gradle 检查失败且不执行配置的成功命令', async () => {
    const { project } = await buildProject('gradle', 7);
    const task = await runFix(project.id, { [JAVA_TEST]: EDITED_TEST });
    expect(task.status).toBe(TaskStatus.Failed);
    const checks = await acceptance(task);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          passed: false,
          autoSelection: expect.objectContaining({ source: 'idea' }),
          output: expect.stringMatching(/AUTOMATIC GRADLE .*test.*demo\.ExampleTest/),
        }),
      ]),
    );
    expect(checks.map(({ output }) => output).join('\n')).not.toContain('CONFIGURED BACKUP COMMAND');
    if (!task.git.worktreePath) throw new Error('Expected the failed task worktree');
    await expect(readFile(join(task.git.worktreePath, 'fallback-fired.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('独立命令模式总是使用保存的检查命令', async () => {
    const { project } = await buildProject('maven', 7);
    await t.call(updateProjectOp, { id: project.id, acceptanceMode: 'command' });
    const task = await runFix(project.id, { [JAVA_TEST]: EDITED_TEST });
    expect(task.status).toBe(TaskStatus.Review);
    const checks = await acceptance(task);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: BACKUP,
          passed: true,
          output: expect.stringContaining('CONFIGURED BACKUP COMMAND'),
        }),
      ]),
    );
    expect(JSON.stringify(checks)).not.toContain('AUTOMATIC MAVEN');
  });
});

it('功能开发计划保留项目检查并在没有适用 IDEA 配置时使用 Node 测试入口', async () => {
  const { project } = await addProject(t, {
    files: {
      '.run/Utility.run.xml':
        '<component name="ProjectRunConfigurationManager"><configuration name="Utility" type="ShellScriptRunConfiguration"/></component>',
      'package.json': JSON.stringify({ scripts: { test: 'node --test smoke.test.cjs' } }),
      'smoke.test.cjs': "require('node:test')('fallback', () => console.log('NODE FALLBACK EVIDENCE'))",
    },
  });
  t.fake.enqueue(
    script().callTool(
      'submit_plan',
      planArgs([{ key: 'implement', acceptance: { command: PROJECT_CHECK_PLACEHOLDER } }, finalVerify(['implement'])]),
    ),
    { agent: 'aw-planner' },
  );
  t.fake.enqueue(script().edit('README.md', 'Edited').callTool('submit_result', { summary: 'Implemented' }), {
    title: '· implement',
  });
  t.fake.enqueue(script().callTool('submit_result', { summary: 'Verified steps' }), { agent: 'aw-executor' });
  t.fake.enqueue(script().callTool('submit_review', { verdict: 'pass', summary: 'Looks right' }), {
    agent: 'aw-reviewer',
  });
  const task = await runWorkflow(project.id, 'feature');
  expect(task.status).toBe(TaskStatus.Review);
  expect(await acceptance(task, 'implement')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        command: 'npm test',
        autoSelection: expect.objectContaining({ source: 'fallback' }),
        passed: true,
        output: expect.stringContaining('NODE FALLBACK EVIDENCE'),
      }),
    ]),
  );
});

it('有 IDEA 配置但找不到支持的检查且无备用命令时报告跳过原因', async () => {
  const { project } = await addProject(t, {
    checkCommand: null,
    files: {
      '.run/Unsupported.run.xml':
        '<component name="ProjectRunConfigurationManager"><configuration name="Tool" type="ShellScriptRunConfiguration" /></component>',
    },
  });
  const task = await runFix(project.id, { 'README.md': 'Edited' });
  expect(task.status).toBe(TaskStatus.Review);
  expect(await acceptance(task)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        skipped: true,
        autoSelection: expect.objectContaining({ source: 'fallback', reason: expect.any(String) }),
      }),
    ]),
  );
});
