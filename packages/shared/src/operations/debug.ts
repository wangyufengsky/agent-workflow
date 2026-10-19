import { z } from 'zod';
import { REQUIREMENT_MAX_CHARS } from '../constants/limits.ts';
import { attemptSchema } from '../contracts/api/attempts.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

/** Development builds only (M2-09): one execute attempt on a directory, without a task. */
export const startDebugAttemptOp = defineOperationContract({
  id: 'debug.startAttempt',
  title: 'op.debug.startAttempt',
  description: 'Development builds: run one execute attempt in a Git directory, outside any task',
  input: z.object({
    directory: z.string().min(1),
    requirement: z.string().min(1).max(REQUIREMENT_MAX_CHARS),
    /** `provider/model`; omitted uses the `ai.defaultModel` setting, then opencode's default. */
    model: z.string().min(1).optional(),
  }),
  output: attemptSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/debug/attempts', status: 201 },
  expose: { palette: false, assistant: false },
  credentialFields: [],
  mode: UiMode.Pro,
});
