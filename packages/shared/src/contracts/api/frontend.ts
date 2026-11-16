import { z } from 'zod';
import { viewportPresetSchema } from '../../enums/browser.ts';
import { WorkflowKind } from '../../enums/workflow.ts';

export const FRONTEND_WORKFLOW_KEY = 'frontend';
export const isFrontendWorkflow = (workflow: { key: string; kind: WorkflowKind }): boolean =>
  workflow.kind === WorkflowKind.Builtin && workflow.key === FRONTEND_WORKFLOW_KEY;

export const FRONTEND_VERIFY_PREFIX = 'frontend_verify_';
export const FRONTEND_ANNOTATION_LIMIT = 6;
export const FRONTEND_NOTE_LIMIT = 300;
export const FRONTEND_FEEDBACK_LIMIT = 1800;

const dimension = z.object({ width: z.number(), height: z.number() });
export const frontendPageLayoutSchema = dimension.extend({ scrollWidth: z.number() });
export const frontendElementSchema = z.object({
  id: z.uuid(),
  path: z.string().max(500),
  viewport: viewportPresetSchema,
  layout: frontendPageLayoutSchema,
  tag: z.string().max(40),
  label: z.string().max(160),
  locator: z.string().max(200),
  box: dimension.extend({ x: z.number(), y: z.number() }),
  styles: z.record(z.string(), z.string()),
});
export type FrontendElement = z.infer<typeof frontendElementSchema>;

export const frontendAnnotationRequestSchema = z.object({
  elementId: z.uuid(),
  note: z.string().trim().min(1).max(FRONTEND_NOTE_LIMIT),
});

export const frontendRoundSchema = z.object({
  nodeId: z.string(),
  feedback: z.string(),
  annotations: z.array(z.object({ element: frontendElementSchema, note: z.string() })),
  before: z.object({ file: z.string(), path: z.string(), viewport: viewportPresetSchema }).nullable(),
});
export type FrontendRound = z.infer<typeof frontendRoundSchema>;

export const localPreviewPathSchema = z
  .string()
  .max(500)
  .regex(/^\/(?![/\\])[^\r\n]*$/);
