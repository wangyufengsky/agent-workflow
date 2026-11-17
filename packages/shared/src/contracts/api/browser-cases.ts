import { z } from 'zod';
import { browserWriteRuleSchema } from '../../browser/policy.ts';
import { TASK_TITLE_MAX_CHARS } from '../../constants/limits.ts';
import { BrowserBlockReason } from '../../enums/browser.ts';
import { errorInfoSchema } from '../../errors/codes.ts';

export const BROWSER_TEST_WORKFLOW_KEY = 'browser_test';
export const browserTestScopeSchema = z.object({
  target: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(
      (target) => /^\/(?!\/)[^\s\\]*$/.test(target) || /^https?:\/\/[^/\s@?#\\]+(?:[/?#][^\s\\]*)?$/i.test(target),
      'Use a preview path or an HTTP(S) address without credentials',
    ),
  writes: z.array(browserWriteRuleSchema).max(20),
});
export type BrowserTestScope = z.infer<typeof browserTestScopeSchema>;

const selector = z.string().trim().min(1).max(500);
const value = z.string().max(4000);

export const browserCaseActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('check') }),
  z.object({ kind: z.literal('click'), selector }),
  z.object({ kind: z.literal('fill'), selector, value }),
  z.object({ kind: z.literal('select'), selector, value: value.min(1) }),
]);

export const browserCaseAssertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('visible'), selector }),
  z.object({ kind: z.literal('text'), selector, value: value.min(1) }),
  z.object({ kind: z.literal('value'), selector, value }),
  z.object({ kind: z.literal('path'), value: value.regex(/^\/(?!\/)/) }),
]);
export type BrowserCaseAssertion = z.infer<typeof browserCaseAssertionSchema>;

const browserCaseStepSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX_CHARS),
  action: browserCaseActionSchema,
  expect: browserCaseAssertionSchema,
});
export type BrowserCaseStep = z.infer<typeof browserCaseStepSchema>;

export const browserCaseInputSchema = z.object({
  name: z.string().trim().min(1).max(TASK_TITLE_MAX_CHARS),
  scope: browserTestScopeSchema,
  steps: z.array(browserCaseStepSchema).min(1).max(30),
});
export type BrowserCaseInput = z.infer<typeof browserCaseInputSchema>;

const revision = z.number().int().positive();
export const browserCaseRevisionSchema = z.object({ caseId: z.string(), revision });
export const browserCaseSchema = browserCaseInputSchema.extend(browserCaseRevisionSchema.shape);
export type BrowserCase = z.infer<typeof browserCaseSchema>;

export const BrowserCaseOutcome = {
  Passed: 'passed',
  Failed: 'failed',
  Blocked: 'blocked',
} as const;
export type BrowserCaseOutcome = (typeof BrowserCaseOutcome)[keyof typeof BrowserCaseOutcome];

const browserCaseRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  blocked: z.enum(BrowserBlockReason).nullable(),
  failed: z.boolean(),
});

export const browserCaseStepResultSchema = z.object({
  /** 0 是打开测试入口，1 起对应用户定义的步骤。 */
  step: z.number().int().nonnegative(),
  outcome: z.enum(BrowserCaseOutcome),
  actual: z.union([z.string(), z.boolean()]).nullable(),
  errorCode: errorInfoSchema.shape.code.nullable(),
  screenshot: z
    .string()
    .regex(/^\d+\.jpg$/)
    .nullable(),
  requests: z.array(browserCaseRequestSchema),
});
export type BrowserCaseStepResult = z.infer<typeof browserCaseStepResultSchema>;

export const browserCaseReportSchema = z.object({
  attemptId: z.string(),
  outcome: z.enum(BrowserCaseOutcome),
  steps: z.array(browserCaseStepResultSchema),
});
export type BrowserCaseReport = z.infer<typeof browserCaseReportSchema>;

export const BrowserCaseChallenge = { Login: 'login', Verification: 'verification' } as const;
export type BrowserCaseChallenge = (typeof BrowserCaseChallenge)[keyof typeof BrowserCaseChallenge];

export const browserCaseHandoffSchema = z.object({
  id: z.string(),
  tabId: z.string(),
  step: z.number().int().nonnegative(),
  reason: z.enum(BrowserCaseChallenge),
  active: z.boolean(),
});
export type BrowserCaseHandoff = z.infer<typeof browserCaseHandoffSchema>;
