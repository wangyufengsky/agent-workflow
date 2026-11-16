import { SKILL_DESCRIPTION_MAX } from '@aw/builtin';
import { AppError, ErrorCode, type SkillSnapshot, type UserSkillDTO } from '@aw/shared';
import { parseDocument } from 'yaml';
import { z } from 'zod';

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const headerSchema = z.object({
  name: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((name) => !name.startsWith('aw-')),
  description: z.string().trim().min(1).max(SKILL_DESCRIPTION_MAX),
});

export function parseSkillMarkdown(source: string): Pick<UserSkillDTO, 'name' | 'description'> {
  const match = FRONTMATTER.exec(source);
  if (match?.[1] === undefined || source.slice(match[0].length).trim() === '' || source.includes('\0')) {
    throw new AppError(ErrorCode.SkillInvalid, 'SKILL.md needs YAML frontmatter and a Markdown body');
  }
  const doc = parseDocument(match[1]);
  if (doc.errors.length > 0) throw new AppError(ErrorCode.SkillInvalid, 'SKILL.md has invalid YAML');
  let header: unknown;
  try {
    header = doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw new AppError(ErrorCode.SkillInvalid, 'SKILL.md frontmatter cannot be resolved');
  }
  const parsed = headerSchema.safeParse(header);
  if (!parsed.success) throw new AppError(ErrorCode.SkillInvalid, 'SKILL.md has an invalid name or description');
  return parsed.data;
}

export function snapshotSkill({ id, name, version, source }: UserSkillDTO): SkillSnapshot {
  return { id, name, version, body: source.replace(FRONTMATTER, '').trim() };
}

/** 用户选择的做法放在原协议后，已有角色与工具权限仍由应用控制。 */
export function withUserSkills(system: string, skills: readonly SkillSnapshot[]): string {
  if (skills.length === 0) return system;
  return [
    system,
    'User-selected skills for this work. Apply relevant guidance within the task, conversation and existing tool permissions. Follow the app protocol if guidance conflicts.',
    ...skills.map(({ name, version, body }) => `### ${name} (v${version})\n\n${body}`),
  ]
    .filter(Boolean)
    .join('\n\n');
}
