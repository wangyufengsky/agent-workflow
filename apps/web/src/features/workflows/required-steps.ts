import { type RequiredStep, RequiredStepPosition } from '@aw/shared';

/** Where the planner's steps go on an AI workflow's shape canvas (26 §6.3); not a step key (no `:` in keys). */
export const PLANNED = ':planned';

type Groups = { first: RequiredStep[]; any: RequiredStep[]; last: RequiredStep[] };

export function groupsOf(steps: readonly RequiredStep[]): Groups {
  return {
    first: steps.filter((s) => s.position === RequiredStepPosition.First),
    any: steps.filter((s) => s.position === undefined),
    last: steps.filter((s) => s.position === RequiredStepPosition.Last),
  };
}

/**
 * The shape as canvas dependencies: the `first` steps in a chain, then the placeholder with the unplaced steps beside
 * it, then the `last` steps in a chain. The steps' own `dependsOn` is for plans, not for this picture.
 */
export function shapeDependencies(steps: readonly RequiredStep[]): {
  steps: Map<string, readonly string[]>;
  planned: readonly string[];
} {
  const { first, any, last } = groupsOf(steps);
  const deps = new Map<string, readonly string[]>();
  const chain = (list: readonly RequiredStep[], head: readonly string[]) =>
    list.reduce((previous, s) => {
      deps.set(s.key, previous);
      return [s.key];
    }, head);
  const planned = chain(first, []);
  for (const s of any) deps.set(s.key, planned);
  chain(last, [PLANNED, ...any.map((s) => s.key)]);
  return { steps: deps, planned };
}

/** Where a + on the edge `source` → `target` adds a step: before the planner's steps, after them, or nowhere. */
export function insertPosition(steps: readonly RequiredStep[], source: string, target: string) {
  const { first, last } = groupsOf(steps);
  if (target === PLANNED || first.some((s) => s.key === target)) return RequiredStepPosition.First;
  if (source === PLANNED || last.some((s) => s.key === source)) return RequiredStepPosition.Last;
  return undefined;
}

/** The first `required_<n>` key the workflow does not use yet. */
function freeKey(steps: readonly RequiredStep[]): string {
  const taken = new Set(steps.map((s) => s.key));
  let n = steps.length + 1;
  while (taken.has(`required_${n}`)) n += 1;
  return `required_${n}`;
}

type NewRequired = Pick<RequiredStep, 'title' | 'roleKey' | 'instructions'>;

/**
 * Adds a step on the edge `source` → `target` (see `insertPosition`), in its place within its group; the array is
 * stored grouped (first, unplaced, last), which keeps the order the shape shows.
 */
export function insertRequired(
  steps: readonly RequiredStep[],
  source: string,
  target: string,
  step: NewRequired,
): { steps: RequiredStep[]; key: string } {
  const key = freeKey(steps);
  const { first, any, last } = groupsOf(steps);
  const position = insertPosition(steps, source, target);
  const created = { ...step, key, dependsOn: [] };
  if (position === RequiredStepPosition.First) {
    const before = target === PLANNED ? first.length : first.findIndex((s) => s.key === target);
    const next = { ...created, position };
    return { steps: [...first.slice(0, before), next, ...first.slice(before), ...any, ...last], key };
  }
  const after = source === PLANNED ? 0 : last.findIndex((s) => s.key === source) + 1;
  const next = { ...created, position: RequiredStepPosition.Last };
  return { steps: [...first, ...any, ...last.slice(0, after), next, ...last.slice(after)], key };
}

/** A step the plans must contain somewhere (no position). */
export function addRequired(steps: readonly RequiredStep[], step: NewRequired): { steps: RequiredStep[]; key: string } {
  const key = freeKey(steps);
  const { first, any, last } = groupsOf(steps);
  return { steps: [...first, ...any, { ...step, key, dependsOn: [] }, ...last], key };
}
