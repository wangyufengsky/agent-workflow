/** Targets typed one per line (20 §2): surrounding whitespace removed, empty lines ignored. */
export const parseTargets = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** Adds or removes one target, keeping the others in their order. */
export const toggleTarget = (targets: readonly string[], target: string): string[] =>
  targets.includes(target) ? targets.filter((t) => t !== target) : [...targets, target];
