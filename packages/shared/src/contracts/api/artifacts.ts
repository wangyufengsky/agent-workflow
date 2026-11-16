import { z } from 'zod';
import { WorkflowKind } from '../../enums/workflow.ts';
import { officeLossSchema } from '../mcp/office-write.ts';
import { officeFilePreviewSchema } from './attachments.ts';

export const ARTIFACT_WORKFLOW_KEY = 'artifact';
export const isArtifactWorkflow = (workflow: { key: string; kind: WorkflowKind }): boolean =>
  workflow.kind === WorkflowKind.Builtin && workflow.key === ARTIFACT_WORKFLOW_KEY;

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
});
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

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

export function artifactAnchorLabel(anchor: ArtifactAnchor): string {
  if (anchor.kind === 'cells') return `${anchor.sheet}!${anchor.range}`;
  if (anchor.kind === 'whole') return '整份文件';
  const { from, to } = anchor.lines;
  const range = from === to ? `第 ${from} 行` : `第 ${from}–${to} 行`;
  return anchor.kind === 'paragraph' && anchor.heading !== '' ? `${anchor.heading} · ${range}` : range;
}

export const textLines = (text: string) => text.replace(/\r\n/g, '\n').split('\n');
