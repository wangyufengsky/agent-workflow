import { z } from 'zod';

/** Sub-codes of `INITIATIVE_BREAKDOWN_INVALID.details.problems[].code` (34 §8.3, §15.2). */
export const InitiativeProblemCode = {
  DuplicateKey: 'DUPLICATE_KEY',
  UnknownDependency: 'UNKNOWN_DEPENDENCY',
  Cycle: 'CYCLE',
  /** A work package depends on one in a later phase. */
  DependencyPhase: 'DEPENDENCY_PHASE',
  EmptyPhase: 'EMPTY_PHASE',
  PhaseOutOfRange: 'PHASE_OUT_OF_RANGE',
  /** The workflow does not exist, or is a system workflow. */
  UnknownWorkflow: 'UNKNOWN_WORKFLOW',
  /** A composition template where no work package's requirement contains `{{requirement}}`. */
  TemplateRequirementMissing: 'TEMPLATE_REQUIREMENT_MISSING',
  /** An edit changed or removed a work package that already started, finished or was dropped. */
  ItemNotEditable: 'ITEM_NOT_EDITABLE',
} as const;
export type InitiativeProblemCode = (typeof InitiativeProblemCode)[keyof typeof InitiativeProblemCode];
export const initiativeProblemCodeSchema = z.enum(InitiativeProblemCode);

export const initiativeProblemSchema = z.object({
  code: initiativeProblemCodeSchema,
  /** The work package, when the problem is about one. */
  itemKey: z.string().optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type InitiativeProblem = z.infer<typeof initiativeProblemSchema>;
