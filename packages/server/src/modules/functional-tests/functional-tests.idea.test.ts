import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readIdeaConfigurations } from './functional-tests.idea.ts';

const temp: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aw-idea-'));
  temp.push(root);
  const worktree = join(root, 'tree');
  const project = join(root, 'project');
  await mkdir(join(worktree, '.run'), { recursive: true });
  await mkdir(join(project, '.idea', 'runConfigurations'), { recursive: true });
  return { root, worktree, project };
}
afterEach(async () => {
  for (const dir of temp.splice(0)) await rm(dir, { recursive: true, force: true });
});

const entry =
  '<configuration name="Query" type="Application"><option name="MAIN_CLASS_NAME" value="sample.Query"/></configuration>';
const shared = (body: string) => `<component name="ProjectRunConfigurationManager">${body}</component>`;

it('发现工作树共享配置及本机未共享的 Spring 启动配置，解析模块 SDK，只返回启动元数据', async () => {
  const { project, worktree } = await fixture();
  await writeFile(join(worktree, '.run/Query.run.xml'), shared(entry));
  await writeFile(join(project, '.idea/runConfigurations/Query.xml'), shared(entry));
  await writeFile(
    join(project, '.idea/misc.xml'),
    '<project><component name="ProjectRootManager" project-jdk-name="temurin-17"/></project>',
  );
  await writeFile(
    join(project, '.idea/modules.xml'),
    '<project><component name="ProjectModuleManager"><modules><module filepath="$PROJECT_DIR$/gateway.iml"/></modules></component></project>',
  );
  await writeFile(
    join(project, 'gateway.iml'),
    '<module><component name="NewModuleRootManager"><orderEntry type="jdk" jdkName="1.8" /></component></module>',
  );
  await writeFile(
    join(project, '.idea/workspace.xml'),
    `<project>
    <component name="Other">${entry}<option value="PRIVATE-HISTORY"/></component>
    <component name="RunManager">
      <configuration name="Service" type="SpringBootApplicationConfigurationType">
        <module name="gateway"/><option name="SPRING_BOOT_MAIN_CLASS" value="sample.Service"/>
        <option name="VM_PARAMETERS" value="-Dpassword=PRIVATE-ARG"/>
        <envs><env name="KEY" value="PRIVATE-ENV"/></envs>
        <extension name="GrepConsole"><option name="ACTIVE_PROFILES" value="PRIVATE-PLUGIN"/></extension>
      </configuration>
      <configuration name="Default" default="true" type="Application"><option name="MAIN_CLASS_NAME" value="PrivateTemplate"/></configuration>
      <configuration name="Suite" type="JUnit"><option name="MAIN_CLASS_NAME" value="PrivateTest"/></configuration>
    </component></project>`,
  );
  const result = await readIdeaConfigurations(worktree, project);
  expect(result).toEqual({
    configurations: [
      {
        name: 'Query',
        type: 'Application',
        mainClass: 'sample.Query',
        source: '.run/Query.run.xml',
        location: 'worktree',
        javaVersion: 17,
        includeProvided: false,
        review: [],
      },
      {
        name: 'Service',
        type: 'SpringBootApplicationConfigurationType',
        mainClass: 'sample.Service',
        module: 'gateway',
        source: '.idea/workspace.xml',
        location: 'project',
        javaVersion: 8,
        includeProvided: true,
        review: ['VM_PARAMETERS', 'environment variables or files'],
      },
    ],
    warnings: [],
  });
});

it('保留同名同主类但本机 JDK 不同的候选配置', async () => {
  const { project, worktree } = await fixture();
  await writeFile(join(worktree, '.run/Query.run.xml'), shared(entry));
  const local = entry.replace(
    '</configuration>',
    '<option name="ALTERNATIVE_JRE_PATH_ENABLED" value="true"/><option name="ALTERNATIVE_JRE_PATH" value="jdk-8"/></configuration>',
  );
  await writeFile(
    join(project, '.idea/workspace.xml'),
    `<project><component name="RunManager">${local}</component></project>`,
  );
  const result = await readIdeaConfigurations(worktree, project);
  expect(result.configurations).toHaveLength(2);
  expect(result.configurations[1]).toMatchObject({ name: 'Query', location: 'project', javaVersion: 8 });
});

it('单个配置的 JDK、工作目录和依赖覆盖项目默认值，同时读取其余有效文件', async () => {
  const { project, worktree } = await fixture();
  await writeFile(
    join(project, '.idea/runConfigurations/Selected.xml'),
    shared(`<configuration name="Tax API" type="SpringBootApplicationConfigurationType">
    <option name="SPRING_BOOT_MAIN_CLASS" value="sample.税率服务"/><option name="INCLUDE_PROVIDED_SCOPE" value="false"/>
    <option name="ALTERNATIVE_JRE_PATH_ENABLED" value="true"/><option name="ALTERNATIVE_JRE_PATH" value="corretto-8"/>
    <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$/services/tax"/><option name="ACTIVE_PROFILES" value="qa"/>
    <method v="2"><option name="RunExternalToolTask" enabled="true"/></method></configuration>`),
  );
  await writeFile(join(worktree, '.run/Unsafe.run.xml'), '<!DOCTYPE invalid><invalid/>');
  const result = await readIdeaConfigurations(worktree, project);
  expect(result.configurations).toEqual([
    expect.objectContaining({
      javaVersion: 8,
      mainClass: 'sample.税率服务',
      directory: 'services/tax',
      profile: 'qa',
      includeProvided: false,
      review: ['before-launch task'],
    }),
  ]);
  expect(result.warnings).toEqual(['worktree/.run/Unsafe.run.xml: could not inspect configuration']);
});

it.skipIf(process.platform === 'win32')('跳过指向项目外部的 IDEA 工作区文件', async () => {
  const { root, project, worktree } = await fixture();
  const outside = join(root, 'outside.xml');
  await writeFile(outside, `<project><component name="RunManager">${entry}</component></project>`);
  await symlink(outside, join(project, '.idea/workspace.xml'));
  const result = await readIdeaConfigurations(worktree, project);
  expect(result.configurations).toEqual([]);
  expect(result.warnings).toEqual(['project/.idea/workspace.xml: could not inspect configuration']);
});
