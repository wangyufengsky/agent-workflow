import { z } from 'zod';
import { NodeStatus } from '../../enums/task.ts';
import { NodeKind, WorkflowKind } from '../../enums/workflow.ts';
import { officeLossSchema } from '../mcp/office-write.ts';
import { officeFilePreviewSchema } from './attachments.ts';

export const ARTIFACT_WORKFLOW_KEY = 'artifact';
export const isArtifactWorkflow = (workflow: { key: string; kind: WorkflowKind }): boolean =>
  workflow.kind === WorkflowKind.Builtin && workflow.key === ARTIFACT_WORKFLOW_KEY;

export const REPOSITORY_DOCUMENT_WORKFLOW = {
  DetailedDesign: 'detailed_design',
  Breakdown: 'breakdown',
} as const;
export const REPOSITORY_DOCUMENT_NODE_KEY = 'write';

export const isRepositoryDocumentWorkflow = (workflow: { key: string; kind: WorkflowKind }): boolean =>
  workflow.kind === WorkflowKind.Builtin &&
  (workflow.key === REPOSITORY_DOCUMENT_WORKFLOW.DetailedDesign ||
    workflow.key === REPOSITORY_DOCUMENT_WORKFLOW.Breakdown);

/** 仅文档编写与修订步骤拥有正在编辑的仓库草稿。 */
export const isWritingRepositoryDocument = (node: { key: string; kind: NodeKind; status: NodeStatus }) =>
  (node.key === REPOSITORY_DOCUMENT_NODE_KEY || node.kind === NodeKind.Revise) &&
  (node.status === NodeStatus.Running ||
    node.status === NodeStatus.WaitingInput ||
    node.status === NodeStatus.Verifying ||
    node.status === NodeStatus.AwaitingAcceptance);

export const repositoryDocumentDraftSchema = z.object({
  path: z.string(),
  text: z.string(),
  truncated: z.boolean(),
});
export type RepositoryDocumentDraft = z.infer<typeof repositoryDocumentDraftSchema>;

export const ARTIFACT_PREVIEW_CHARS = 200_000;
export const ARTIFACT_NOTE_LIMIT = 1000;
export const ARTIFACT_NOTES_MAX = 12;

export const artifactNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[^/\\:<>"|?*]+\.(docx|xlsx|md|txt)$/i, 'Use a file name ending in .docx, .xlsx, .md or .txt')
  .refine((name) => Array.from(name).every((char) => char.charCodeAt(0) >= 32), 'Use a printable file name')
  .refine((name) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name), 'Use a portable file name');

export const artifactVersionSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  name: artifactNameSchema,
  size: z.number(),
  attemptId: z.string(),
  nodeId: z.string(),
  createdAt: z.number(),
  lost: z.array(officeLossSchema),
  repository: z
    .object({
      path: z.string(),
      commit: z.string(),
      originalPath: z.string().optional(),
      integratedDeliveryId: z.string().optional(),
    })
    .optional(),
});
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

export function artifactDocumentKey(version: ArtifactVersion) {
  return version.repository?.originalPath ?? version.repository?.path ?? version.name;
}

export function latestDocumentVersions(versions: ArtifactVersion[]) {
  return new Map(versions.map((version) => [artifactDocumentKey(version), version]));
}

const lines = z
  .object({
    from: z.number().int().positive(),
    to: z.number().int().positive(),
  })
  .refine(({ from, to }) => from <= to);

const anchor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('whole') }),
  z.object({ kind: z.literal('paragraph'), lines, heading: z.string().max(250) }),
  z.object({ kind: z.literal('lines'), lines }),
  z.object({
    kind: z.literal('cells'),
    sheet: z.string().min(1).max(31),
    range: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$/),
  }),
]);
export type ArtifactAnchor = z.infer<typeof anchor>;

export const artifactNoteSchema = z.object({
  anchor,
  quote: z.string().max(2400),
  note: z.string().trim().min(1).max(ARTIFACT_NOTE_LIMIT),
});
export type ArtifactNote = z.infer<typeof artifactNoteSchema>;

export const artifactRevisionSchema = z.object({
  id: z.string(),
  versionId: z.uuid(),
  notes: z.array(artifactNoteSchema).min(1).max(ARTIFACT_NOTES_MAX),
});
export type ArtifactRevision = z.infer<typeof artifactRevisionSchema>;

export const artifactRoundSchema = artifactRevisionSchema.omit({ id: true }).extend({
  nodeId: z.string(),
  notes: z.array(artifactNoteSchema.extend({ id: z.uuid() })),
});
export const artifactTaskSchema = z.object({
  versions: z.array(artifactVersionSchema),
  rounds: z.array(artifactRoundSchema),
});

export const artifactPreviewSchema = z.union([
  officeFilePreviewSchema,
  z.object({ format: z.enum(['md', 'txt']), text: z.string(), truncated: z.boolean() }),
]);
export type ArtifactPreview = z.infer<typeof artifactPreviewSchema>;

export const textLines = (text: string) => text.replace(/\r\n/g, '\n').split('\n');
