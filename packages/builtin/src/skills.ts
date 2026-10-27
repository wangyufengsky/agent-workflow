/**
 * Skills in `packages/builtin/skills/<name>/SKILL.md` (41), by name. opencode reads them from the directory the
 * backend puts into `skills.paths` (D206); which agent sees which one is decided in the opencode configuration (D207).
 */
export const SkillName = {
  /** The assistant finds out why a task failed or is stuck and what to do next (41 §5.1). */
  TaskDiagnosis: 'aw-task-diagnosis',
} as const;
export type SkillName = (typeof SkillName)[keyof typeof SkillName];

/** A skill is one `SKILL.md` and nothing else (D209). */
export const SKILL_FILE = 'SKILL.md';
export const SKILL_MAX_BYTES = 8 * 1024;
/** The description is listed in every session the skill is given to (41 §6.1). */
export const SKILL_DESCRIPTION_MAX = 400;
/** Skills one agent may be given (D212). */
export const AGENT_SKILLS_MAX = 8;
