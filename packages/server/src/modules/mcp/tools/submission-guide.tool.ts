import { SkillName } from '@aw/builtin';
import {
  ACTIVE_ATTEMPT_STATUSES,
  ATTEMPT_SUBMIT_TOOL,
  type AttemptDTO,
  AttemptKind,
  ErrorCode,
  type ErrorInfo,
  MCP_TOOL_PREFIX,
  McpToolName,
  RequirementVerification,
  ServerEventType,
  type SubmissionGuide,
  type SubmissionRejection,
  submissionGuideInputSchema,
  submissionGuideOutputSchema,
  submitBrowserReportInputSchema,
  submitPlanInputSchema,
  submitResultInputSchema,
  submitReviewInputSchema,
  type TaskCodeReviewInput,
  taskCodeReviewScopeSchema,
} from '@aw/shared';
import { z } from 'zod';
import type { EventBus } from '../../../core/event-bus.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

const kinds = [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review] as const;
const submissionSchemas = {
  [McpToolName.SubmitResult]: submitResultInputSchema,
  [McpToolName.BrowserSubmitReport]: submitBrowserReportInputSchema,
  [McpToolName.SubmitPlan]: submitPlanInputSchema,
  [McpToolName.SubmitReview]: submitReviewInputSchema,
};
type SubmissionTool = keyof typeof submissionSchemas;

function parameters(tool: SubmissionTool, omit: string[] = []) {
  const schema = submissionSchemas[tool].toJSONSchema({ io: 'input' });
  const properties = Object.entries(schema.properties ?? {}).filter(([key]) => !omit.includes(key));
  return {
    required: schema.required ?? [],
    allowed: properties.map(([key]) => key),
    omit,
    parameters: Object.fromEntries(
      properties.map(([key, spec]) => [
        key,
        typeof spec === 'object' ? [spec.type, spec.description].filter(Boolean).join(' — ') : '',
      ]),
    ),
  };
}

const correctable: readonly ErrorCode[] = [
  ErrorCode.ValidationFailed,
  ErrorCode.RequirementResultsInvalid,
  ErrorCode.McpToolNotAllowed,
  ErrorCode.PlanInvalid,
  ErrorCode.GitReviewFindingsInvalid,
];

export function createSubmissionGuides(tasks: TasksService, events: EventBus) {
  const last = new Map<
    string,
    { rejection: SubmissionRejection; summary?: string; failingReview: boolean; scope?: TaskCodeReviewInput['scope'] }
  >();
  events.subscribe((event) => {
    if (event.type === ServerEventType.AttemptUpdated && !ACTIVE_ATTEMPT_STATUSES.includes(event.data.attempt.status))
      last.delete(event.data.attempt.id);
  });

  function guide(attempt: AttemptDTO, args: Record<string, unknown> = {}): SubmissionGuide {
    const tool = tasks.browserTestSubmit(attempt) ?? ATTEMPT_SUBMIT_TOOL[attempt.kind];
    const saved = last.get(attempt.id);
    const summarySchema = submissionSchemas[tool as SubmissionTool].shape.summary;
    const summary = summarySchema.safeParse(args.summary ?? saved?.summary);
    const exampleSummary = summary.success
      ? summary.data
      : '<Describe the work you actually completed and its evidence>';
    const previous = saved?.rejection;
    const common = {
      skill: SkillName.SubmitResult,
      tool,
      remove: previous?.remove ?? [],
      ...(previous ? { lastRejection: previous } : {}),
    };
    if (tool === McpToolName.SubmitPlan) {
      const plan = attempt.taskId === null ? undefined : tasks.taskContext(attempt).planning;
      const nodes =
        plan?.requiredSteps.map((n) => ({
          key: n.key,
          title: n.title,
          role: n.roleKey,
          instructions: n.instructions,
          depends_on: n.dependsOn,
        })) ?? [];
      return {
        ...common,
        ...parameters(tool),
        example: {
          summary: exampleSummary,
          nodes: nodes.length
            ? nodes
            : [
                {
                  key: 'implement',
                  title: 'Implement the change',
                  role: plan?.allowedRoles[0]?.key ?? 'developer',
                  instructions: 'Implement the requested change and verify its outcome.',
                },
              ],
        },
        instructions:
          'Build the complete plan for the requirement. Include all required steps and use the allowed roles from get_task_context.',
      };
    }
    if (tool === McpToolName.SubmitReview)
      return {
        ...common,
        ...parameters(tool),
        example:
          args.verdict === 'fail' || saved?.failingReview
            ? {
                verdict: 'fail',
                summary: exampleSummary,
                issues: [{ severity: 'major', description: '<Describe the actual blocking issue and its location>' }],
              }
            : { verdict: 'pass', summary: exampleSummary },
        instructions:
          'Use pass only with confirmed evidence. For fail include actual issues with severity blocker or major and their location.',
      };
    const report = tool === McpToolName.BrowserSubmitReport;
    const fields = tasks.resultSubmissionFields(attempt);
    const omit = Object.keys(submitResultInputSchema.shape).filter((k) =>
      report
        ? !(k in submitBrowserReportInputSchema.shape)
        : (k === 'code_review' && !fields.review) || (k === 'requirement_results' && !fields.verify),
    );
    const example: Record<string, unknown> = { summary: exampleSummary };
    let instructions =
      'Start with summary. Add valid changes, self_check or evidenced handoff when useful. Delete omitted keys entirely, including empty arrays and objects.';
    if (fields.artifact)
      instructions += ' Publish the finished document with the artifact tool before submitting the result.';
    if (report)
      instructions =
        'Describe each test, its expected and actual outcome and the evidence. Keep screenshot filenames in the report.';
    if (fields.verify && !report) {
      const items = tasks
        .taskContext(attempt)
        .requirements.filter((item) => item.verification === RequirementVerification.AiReview);
      example.requirement_results = items.map((item) => ({
        item_id: item.id,
        conclusion: 'unverified',
        note: '<Give the evidence for the actual conclusion, or explain what remains unverified>',
      }));
      instructions =
        'Report verified conclusions for the listed checklist IDs. Use pass, fail or unverified based on actual evidence.';
    }
    if (fields.review && !report) {
      const { workspace } = tasks.taskContext(attempt);
      const supplied = z.object({ scope: taskCodeReviewScopeSchema }).safeParse(args.code_review);
      example.code_review = {
        scope: supplied.success
          ? supplied.data.scope
          : (saved?.scope ?? { kind: 'files', commit: workspace.baseCommit, directory: '' }),
        findings: [],
      };
      instructions =
        'For a file review use the exact reviewed commit and directory. For a diff use scope {kind:"diff",from,to} with the full commit IDs actually reviewed. Retain and correct your actual findings. An empty findings array is only for a review with no findings.';
    }
    return {
      ...common,
      ...parameters(report ? McpToolName.BrowserSubmitReport : McpToolName.SubmitResult, omit),
      example,
      instructions,
    };
  }

  return {
    tool: defineMcpTool({
      name: McpToolName.GetSubmissionGuide,
      description:
        'Read the submission contract, example and most recent rejection for your current workflow step. Call with {} after a rejected submission.',
      allowedKinds: kinds,
      input: submissionGuideInputSchema,
      output: submissionGuideOutputSchema,
      handler: (_, { attempt }) => guide(attempt),
    }),
    rejected(attempt: AttemptDTO, name: McpToolName, args: Record<string, unknown>, error: ErrorInfo) {
      if (!(name in submissionSchemas) || !kinds.some((kind) => kind === attempt.kind)) return;
      if (!correctable.includes(error.code)) return;
      const guidance = guide(attempt, args);
      const remove = Object.keys(args).filter((key) => !guidance.allowed.includes(key));
      const handoff = args.handoff;
      if (
        handoff &&
        typeof handoff === 'object' &&
        !Array.isArray(handoff) &&
        Object.values(handoff).every((v) => Array.isArray(v) && v.length === 0) &&
        !remove.includes('handoff')
      )
        remove.push('handoff');
      const issues = z
        .array(z.object({ path: z.array(z.union([z.string(), z.number()])) }))
        .safeParse(error.details?.issues);
      const fields = issues.success ? issues.data.map((issue) => issue.path.join('.')) : [];
      const detail = { tool: name, code: error.code, message: error.message, remove, fields };
      const summary = submitResultInputSchema.shape.summary.safeParse(args.summary);
      const review = z.object({ scope: taskCodeReviewScopeSchema }).safeParse(args.code_review);
      last.set(attempt.id, {
        rejection: detail,
        ...(summary.success ? { summary: summary.data } : {}),
        failingReview: args.verdict === 'fail',
        ...(review.success && guidance.allowed.includes('code_review') ? { scope: review.data.scope } : {}),
      });
      return {
        ...guidance,
        remove,
        lastRejection: detail,
        next: `Load ${SkillName.SubmitResult} with skill, call ${MCP_TOOL_PREFIX}${McpToolName.GetSubmissionGuide} with {}, then correct and resubmit using the named tool.`,
      };
    },
  };
}
