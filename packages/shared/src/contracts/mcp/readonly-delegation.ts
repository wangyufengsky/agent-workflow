import { z } from 'zod';
import {
  DELEGATION_MAX_CHILDREN,
  DELEGATION_QUESTION_MAX_CHARS,
  DELEGATION_SUMMARY_MAX_CHARS,
} from '../../constants/limits.ts';

const hasControl = (value: string) => [...value].some((character) => character.charCodeAt(0) < 32);
const question = z.string().trim().min(1).max(DELEGATION_QUESTION_MAX_CHARS);
const path = z
  .string()
  .max(500)
  .refine(
    (value) =>
      value === '' ||
      (!hasControl(value) &&
        !value.includes(':') &&
        !value.includes('\\') &&
        value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')),
    'Use a repository-relative path with / separators',
  );

export const delegateReadonlyInputSchema = z.object({
  questions: z.array(question).min(1).max(DELEGATION_MAX_CHILDREN),
});

export const inspectDelegationInputSchema = z
  .object({
    action: z.enum(['list', 'read', 'search']),
    path: path.default(''),
    query: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .refine((value) => !hasControl(value))
      .optional(),
    startLine: z.number().int().min(1).max(1_000_000).default(1),
  })
  .superRefine(({ action, path, query }, ctx) => {
    if (action === 'read' && path === '') ctx.addIssue({ code: 'custom', path: ['path'], message: 'Choose a file' });
    if (action === 'search' && query === undefined)
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'Provide a literal to search' });
  });

export const inspectDelegationOutputSchema = z.object({
  commit: z.string(),
  paths: z.array(z.string()).optional(),
  text: z.string().optional(),
  startLine: z.number().optional(),
  nextLine: z.number().optional(),
  unavailable: z.enum(['binary', 'too_large']).optional(),
  truncated: z.boolean().optional(),
});

export const submitDelegationInputSchema = z.object({
  summary: z.string().trim().min(1).max(DELEGATION_SUMMARY_MAX_CHARS),
});

export const delegateReadonlyOutputSchema = z.object({
  commit: z.string(),
  results: z.array(
    z.discriminatedUnion('status', [
      z.object({
        status: z.literal('succeeded'),
        question,
        attemptId: z.string(),
        summary: z.string(),
        sources: z.array(z.object({ path: z.string(), startLine: z.number(), endLine: z.number() })),
      }),
      z.object({
        status: z.literal('failed'),
        question,
        attemptId: z.string(),
        reason: z.string(),
      }),
      z.object({
        status: z.literal('unavailable'),
        question,
        reason: z.literal('model_slots_busy'),
      }),
    ]),
  ),
});

export type DelegateReadonlyOutput = z.output<typeof delegateReadonlyOutputSchema>;
export type InspectDelegationInput = z.output<typeof inspectDelegationInputSchema>;
export type InspectDelegationOutput = z.output<typeof inspectDelegationOutputSchema>;
