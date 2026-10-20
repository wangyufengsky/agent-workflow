import { z } from 'zod';

export const DiffFileStatus = {
  Added: 'added',
  Modified: 'modified',
  Deleted: 'deleted',
  Renamed: 'renamed',
} as const;
export type DiffFileStatus = (typeof DiffFileStatus)[keyof typeof DiffFileStatus];

export const diffFileSchema = z.object({
  path: z.string(),
  status: z.enum(DiffFileStatus),
  /** Null for binary files. */
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
});
export type DiffFile = z.infer<typeof diffFileSchema>;

/** `get_task_diff` (12 §6.3): committed and uncommitted changes of the worktree against the task's base commit. */
export const getTaskDiffInputSchema = z.object({
  path: z.string().min(1).optional().describe('A changed file; omit to list every changed file'),
});
export const getTaskDiffOutputSchema = z.union([
  z.object({ files: z.array(diffFileSchema) }),
  z.object({ path: z.string(), diff: z.string() }),
]);
export type TaskDiffOutput = z.infer<typeof getTaskDiffOutputSchema>;
