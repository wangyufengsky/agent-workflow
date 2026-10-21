import { z } from 'zod';
import { KNOWLEDGE_QUESTION_MAX_CHARS, LIST_PAGE_DEFAULT, LIST_PAGE_MAX } from '../../constants/limits.ts';
import { CitationType, knowledgeTurnStatusSchema } from '../../enums/knowledge.ts';
import { errorInfoSchema } from '../../errors/codes.ts';
import { dbQueryOutputSchema } from '../mcp/db-tools.ts';
import { attemptSummarySchema } from './attempts.ts';

/** What a conversation's questions may draw on (18 §2.1); fixed once the conversation starts (D67). */
export const knowledgeSourcesSchema = z
  .object({ code: z.boolean(), docs: z.boolean(), database: z.boolean(), web: z.boolean() })
  .refine((s) => s.code || s.docs || s.database, {
    message: 'Select at least one of code, docs or database',
    path: ['code'],
  });
export type KnowledgeSources = z.infer<typeof knowledgeSourcesSchema>;

const question = z.string().trim().min(1).max(KNOWLEDGE_QUESTION_MAX_CHARS);

/** A stored citation (18 §6.1): numbered by its position in the turn, from 1. */
export const citationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(CitationType.File),
    path: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    source: z.enum(['code', 'docs']),
    /** The cited lines when the answer was given, cut to `KNOWLEDGE_EXCERPT_MAX_CHARS`. */
    excerpt: z.string(),
  }),
  z.object({ type: z.literal(CitationType.Database), connection: z.string(), sql: z.string() }),
  z.object({ type: z.literal(CitationType.Web), url: z.string(), title: z.string().nullable() }),
]);
export type CitationDTO = z.infer<typeof citationSchema>;

export const knowledgeTurnSchema = z.object({
  id: z.string(),
  seq: z.number(),
  question: z.string(),
  status: knowledgeTurnStatusSchema,
  /** Progress, error and timing; the research process is this attempt's transcript. */
  attempt: attemptSummarySchema,
  /** A permission request of the researcher waits in「需要你处理」. */
  awaitingInput: z.boolean(),
  answer: z.string().nullable(),
  citations: z.array(citationSchema),
  createdAt: z.number(),
  answeredAt: z.number().nullable(),
});
export type KnowledgeTurnDTO = z.infer<typeof knowledgeTurnSchema>;

const projectRef = z.object({ id: z.string(), name: z.string() });

export const knowledgeConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  sources: knowledgeSourcesSchema,
  /** `repoPath` is where the researcher works: its file paths are shown relative to it. */
  project: projectRef.extend({ repoPath: z.string(), databaseCount: z.number() }),
  turns: z.array(knowledgeTurnSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type KnowledgeConversationDTO = z.infer<typeof knowledgeConversationSchema>;

export const knowledgeConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  project: projectRef,
  turnCount: z.number(),
  latest: z.object({
    status: knowledgeTurnStatusSchema,
    /** The answer's beginning as plain text. */
    answerExcerpt: z.string().nullable(),
    citationCount: z.number(),
    error: errorInfoSchema.nullable(),
  }),
  updatedAt: z.number(),
});
export type KnowledgeConversationSummaryDTO = z.infer<typeof knowledgeConversationSummarySchema>;

/** Opaque to clients: where the previous page ended (`<updatedAt>.<id>` of its last conversation). */
export const knowledgeCursorSchema = z.string().regex(/^\d+\.[\w-]+$/);

export const listKnowledgeQuerySchema = z.object({
  projectId: z.string().optional(),
  /** Matches questions and answers. */
  query: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_PAGE_MAX).default(LIST_PAGE_DEFAULT),
  cursor: knowledgeCursorSchema.optional(),
});
export type ListKnowledgeQuery = z.infer<typeof listKnowledgeQuerySchema>;

export const askKnowledgeRequestSchema = z.object({
  projectId: z.string(),
  question,
  sources: knowledgeSourcesSchema,
});
export type AskKnowledgeRequest = z.infer<typeof askKnowledgeRequestSchema>;

export const followUpKnowledgeRequestSchema = z.object({ id: z.string(), question });

/** The original behind one citation (18 §6.3). */
export const citationSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(CitationType.File),
    path: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    /** Line number of `lines[0]`: a window around the cited range. */
    firstLine: z.number(),
    lines: z.array(z.string()),
    lineCount: z.number(),
    /** The cited range no longer reads as it did when the answer was given. */
    changed: z.boolean(),
  }),
  z.object({
    type: z.literal(CitationType.Database),
    connection: z.string(),
    sql: z.string(),
    result: dbQueryOutputSchema,
  }),
  z.object({ type: z.literal(CitationType.Web), url: z.string(), title: z.string().nullable() }),
]);
export type CitationSourceDTO = z.infer<typeof citationSourceSchema>;
