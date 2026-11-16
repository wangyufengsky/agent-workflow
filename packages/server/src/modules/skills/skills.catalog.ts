import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_SKILLS, ASSISTANT_SKILLS, builtinSkillHeader, SKILL_FILE, SkillName } from '@aw/builtin';
import { type BuiltinSkillDTO, SessionAgent } from '@aw/shared';

export function readBuiltinSkills(dir: string): BuiltinSkillDTO[] {
  const agents = Object.values(SessionAgent);
  return Object.values(SkillName).map((name) => {
    const source = readFileSync(join(dir, name, SKILL_FILE), 'utf8');
    const header = builtinSkillHeader(source);
    if (header.name !== name || header.description === undefined) {
      throw new Error(`Invalid built-in skill header for ${name}`);
    }
    return {
      name,
      source,
      description: header.description,
      assistantEnabled: ASSISTANT_SKILLS.includes(name),
      agents: agents.filter((agent) => AGENT_SKILLS[agent].includes(name)),
    };
  });
}
