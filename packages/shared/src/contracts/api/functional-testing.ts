import { z } from 'zod';
import { FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT } from '../../constants/functional-testing.ts';
import { browserCaseActionSchema, browserCaseAssertionSchema } from './browser-cases.ts';

const id = z.string().min(1).max(160);
const note = z.string().trim().min(1).max(4000);
const path = z
  .string()
  .max(2048)
  .regex(/^\/(?!\/)[^\s\\#]*$/);
const version = z.number().int().positive();
const at = z.number().int().nonnegative();

const httpStep = z.object({
  kind: z.literal('http'),
  title: note,
  method: z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path,
  body: z.json().optional(),
  assertions: z
    .array(
      z.object({
        field: z.string().regex(/^(status|body(?:\.[\w-]+)*)$/),
        equals: z.json(),
        basis: note,
      }),
    )
    .min(1)
    .max(20),
});

const browserStep = z.object({
  kind: z.literal('browser'),
  title: note,
  action: z.union([
    browserCaseActionSchema,
    z.object({ kind: z.literal('open'), path }),
    z.object({ kind: z.literal('reload') }),
  ]),
  expect: browserCaseAssertionSchema,
  basis: note,
});

const caseDefinition = z.object({
  title: note,
  requirement: note,
  preconditions: z.array(note).max(20).default([]),
  requires: z.array(id).max(10).default([]),
  data: z.string().max(4000).default(''),
  steps: z.array(z.discriminatedUnion('kind', [httpStep, browserStep])).max(40),
  cleanup: z.array(httpStep).max(10).default([]),
  source: z.object({ attachmentId: id, originalId: id.optional(), location: note }).optional(),
  needsClarification: note.optional(),
});
export const functionalTestCaseSaveSchema = caseDefinition.extend({
  id: id.optional(),
  requires: z
    .array(
      id.regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Use a check key such as rates_ping, without prose, URL or HTTP status'),
    )
    .max(10)
    .default([]),
});
export const functionalTestCaseSchema = caseDefinition.extend({ id, number: id, version });
export type FunctionalTestCase = z.infer<typeof functionalTestCaseSchema>;
export type FunctionalTestStep = FunctionalTestCase['steps'][number];

const probeSchema = z.object({
  key: id,
  path: path.refine((value) => !value.includes('?')),
  expectedStatus: z.number().int().min(100).max(599),
});
export type FunctionalTestProbe = z.infer<typeof probeSchema>;
const repoPath = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !/[\p{Cc}:\\]/u.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'),
    'Expected a path relative to the worktree',
  );
const javaIdentifier = /^[\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}]*$/u;
const javaReserved = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double else enum extends final ' +
    'finally float for goto if implements import instanceof int interface long native new package private protected ' +
    'public return short static strictfp super switch synchronized this throw throws transient try void volatile while ' +
    'true false null'
  ).split(' '),
);
export const functionalTestMainClassSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) => value.split('.').every((part) => javaIdentifier.test(part) && !javaReserved.has(part)),
    'Expected a Java class name, optionally qualified by its package',
  );

export const functionalTestLaunchSchema = z
  .strictObject({
    directory: z.union([z.literal('.'), repoPath]),
    source: repoPath,
    script: z
      .string()
      .max(128)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/),
    profile: z.enum(['test', 'qa']).optional(),
    readyPath: probeSchema.shape.path,
    mainClass: functionalTestMainClassSchema.optional(),
    javaVersion: z.number().int().min(8).optional(),
    includeProvided: z.boolean().optional(),
  })
  .superRefine((launch, ctx) => {
    const javaMain =
      launch.script === FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT && launch.source.split('/').at(-1) !== 'package.json';
    if (javaMain !== (launch.mainClass !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['mainClass'],
        message: javaMain ? 'Select the mainClass for java-main' : 'mainClass is only accepted for java-main',
      });
    }
    if (!javaMain) {
      for (const field of ['javaVersion', 'includeProvided'] as const) {
        if (launch[field] !== undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: `${field} is only accepted for java-main` });
        }
      }
    }
    if (javaMain && launch.profile !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['profile'], message: 'java-main does not accept a Spring profile' });
    }
  });
export type FunctionalTestLaunch = z.infer<typeof functionalTestLaunchSchema>;
export const functionalTestPrepareSchema = z.object({
  checks: z.array(probeSchema).max(10).optional(),
  launch: functionalTestLaunchSchema.optional(),
});
export type FunctionalTestPrepare = z.output<typeof functionalTestPrepareSchema>;

export const functionalTestEnvironmentSchema = z.object({
  id,
  target: z.string(),
  baseline: z.string().nullable(),
  verified: z.boolean(),
  ready: z.boolean(),
  reason: z.string().nullable(),
  logTail: z.string(),
  launch: functionalTestLaunchSchema.optional(),
  command: z.string().optional(),
  readyUrl: z.string().optional(),
  readyStatus: z.number().int().min(100).max(599).optional(),
  checks: z
    .array(
      probeSchema.extend({ status: z.number().int().nullable(), ready: z.boolean(), reason: z.string().nullable() }),
    )
    .default([]),
});
export const functionalTestRunSchema = z.object({ id, createdAt: at, environment: functionalTestEnvironmentSchema });
export type FunctionalTestRun = z.infer<typeof functionalTestRunSchema>;
export const FunctionalTestStatus = {
  Running: 'running',
  Passed: 'passed',
  Failed: 'failed',
  Blocked: 'blocked',
  NotRun: 'not_run',
} as const;
export type FunctionalTestStatus = (typeof FunctionalTestStatus)[keyof typeof FunctionalTestStatus];
const status = z.enum(FunctionalTestStatus);
export const functionalTestExecutionSchema = z.object({
  id,
  runId: id,
  caseId: id,
  version,
  status,
  startedAt: at,
  finishedAt: at.nullable(),
});
export type FunctionalTestExecution = z.infer<typeof functionalTestExecutionSchema>;
export const functionalTestEventSchema = z.object({
  seq: version,
  runId: id.nullable(),
  caseId: id.nullable(),
  executionId: id.nullable(),
  step: z.number().int().nonnegative().nullable(),
  at,
  kind: z.enum(['case', 'revision', 'environment', 'execution', 'action', 'result', 'assertion', 'cleanup', 'handoff']),
  message: z.string(),
  detail: z.record(z.string(), z.json()),
});
export type FunctionalTestEvent = z.infer<typeof functionalTestEventSchema>;

export const functionalTestReportSchema = z.object({
  runId: id,
  version,
  markdown: z.string(),
  createdAt: at,
  counts: z.object({ passed: at, failed: at, blocked: at, not_run: at }),
  items: z.array(z.object({ caseId: id, number: id, title: note, version, status, executionId: id.nullable() })),
});
export type FunctionalTestReport = z.infer<typeof functionalTestReportSchema>;
export const functionalTestSnapshotSchema = z.object({
  cases: z.array(functionalTestCaseSchema),
  inheritedChecks: z.array(probeSchema).optional(),
  runs: z.array(functionalTestRunSchema),
  executions: z.array(functionalTestExecutionSchema),
  events: z.array(functionalTestEventSchema),
  reports: z.array(functionalTestReportSchema),
  nextAfter: at,
});
export type FunctionalTestSnapshot = z.infer<typeof functionalTestSnapshotSchema>;
export const functionalTestReadSchema = z.object({
  runId: id.optional(),
  caseId: id.optional(),
  step: z.coerce.number().int().nonnegative().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
});
export type FunctionalTestRead = z.infer<typeof functionalTestReadSchema>;
export const functionalTestRunInputSchema = z.object({ runId: id, caseId: id, version, executionId: id });
export const functionalTestReviseSchema = functionalTestRunInputSchema.omit({ runId: true }).extend({
  definition: caseDefinition.optional(),
  change: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('rename_request_field'),
        step: z.number().int().nonnegative(),
        from: z.string().regex(/^[\w-]+$/),
        to: z.string().regex(/^[\w-]+$/),
      }),
      z.object({
        kind: z.literal('correct_success_status'),
        step: z.number().int().nonnegative(),
        expected: z.number().int().min(200).max(299),
      }),
    ])
    .optional(),
  reason: note,
  basis: note,
  contractPath: z.string().max(500).optional(),
});
export const functionalTestRevisionResultSchema = z.object({
  case: functionalTestCaseSchema,
  pending: z.boolean(),
  proposal: z.number().int().positive().optional(),
  reason: z.string().optional(),
});
export const functionalTestReportSubmitSchema = z.object({
  runId: id,
  executionIds: z.array(id).max(250),
  findings: z
    .array(z.object({ executionId: id, description: note }))
    .max(100)
    .optional(),
  uncovered: z.array(note).max(50).optional(),
});
