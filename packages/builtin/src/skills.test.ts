import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtinSkillHeader, SKILL_DESCRIPTION_MAX, SKILL_FILE, SKILL_MAX_BYTES, SkillName } from './skills.ts';

const SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url));
const dirs = readdirSync(SKILLS_DIR);

describe('内置 skill（41 §6）', () => {
  it('SkillName 与 skills 目录一一对应', () => {
    expect(dirs.toSorted()).toEqual(Object.values(SkillName).toSorted());
  });

  it.each(dirs)('%s：只有 SKILL.md，头部只有与目录同名的 name 和不超长的 description，正文不超过上限', (dir) => {
    expect(readdirSync(join(SKILLS_DIR, dir))).toEqual([SKILL_FILE]);
    const file = join(SKILLS_DIR, dir, SKILL_FILE);
    expect(statSync(file).size).toBeLessThanOrEqual(SKILL_MAX_BYTES);
    const { name, description, ...rest } = builtinSkillHeader(readFileSync(file, 'utf8'));
    expect(rest).toEqual({});
    expect(name).toBe(dir);
    expect(name).toMatch(/^aw-[a-z0-9-]+$/);
    expect(description).toMatch(/^Use when /);
    expect(description?.length).toBeLessThanOrEqual(SKILL_DESCRIPTION_MAX);
  });
});
