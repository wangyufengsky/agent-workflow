import { z } from 'zod';
import { KNOWLEDGE_ANSWER_MAX_CHARS, KNOWLEDGE_MAX_CITATIONS } from '../../constants/limits.ts';
import { CitationType } from '../../enums/knowledge.ts';

const line = z.number().int().min(1);

/** One citation as the model gives it (18 §6.1). */
export const submittedCitationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(CitationType.File),
    path: z.string().min(1).describe('Path relative to the repository root'),
    start_line: line.describe('First cited line, from 1'),
    end_line: line.describe('Last cited line, inclusive'),
  }),
  z.object({
    type: z.literal(CitationType.Database),
    connection: z.string().min(1).describe('Connection name from db_list_connections'),
    sql: z.string().min(1).describe('The read-only query whose result supports the statement'),
  }),
  z.object({
    type: z.literal(CitationType.Web),
    url: z.url({ protocol: /^https?$/ }).describe('Only when web access is on for this question'),
    title: z.string().min(1).optional(),
  }),
]);
export type SubmittedCitation = z.infer<typeof submittedCitationSchema>;

/** `submit_answer` (18 §6.1). */
export const submitAnswerInputSchema = z.object({
  answer: z
    .string()
    .min(1)
    .max(KNOWLEDGE_ANSWER_MAX_CHARS)
    .describe('The answer in Markdown; mark each supported statement with [n], n being the citation position from 1'),
  citations: z.array(submittedCitationSchema).max(KNOWLEDGE_MAX_CITATIONS).describe('The sources the markers refer to'),
});
export type SubmitAnswerInput = z.infer<typeof submitAnswerInputSchema>;
export const submitAnswerOutputSchema = z.object({ accepted: z.literal(true) });
