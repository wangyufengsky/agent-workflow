import { SkillName } from '@aw/builtin';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';

/** Real opencode 1.19.0; no model is called (07 §2). Which agent sees which skill needs a model: live (41 §9). */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
});
afterEach(() => t.close());

const skillFile = (name: string) => `---\nname: ${name}\ndescription: Use when testing.\n---\n\nBody.\n`;

describe('@opencode 内置 skill（41）', () => {
  it('opencode 找到应用自带的 skill，不扫描仓库里 .agents 与 .claude 下的 skill（D206、D207）', async () => {
    const repo = await createTestRepo({
      files: {
        '.agents/skills/repo-agents/SKILL.md': skillFile('repo-agents'),
        '.claude/skills/repo-claude/SKILL.md': skillFile('repo-claude'),
      },
    });
    const { data } = await t.app.services.runtime.sdk().app.skills({ directory: repo.path }, { throwOnError: true });
    const names = data.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(Object.values(SkillName)));
    expect(names).not.toContain('repo-agents');
    expect(names).not.toContain('repo-claude');
  });
});
