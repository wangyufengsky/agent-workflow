import { AppError, createTaskRequestSchema, ErrorCode, FUNCTIONAL_TEST_WORKFLOW_KEY } from '@aw/shared';
import { parseInput } from '../../core/http/errors.ts';
import type { WorkflowsService } from '../workflows/index.ts';

export const assistantTaskInputSchema = createTaskRequestSchema
  .omit({ permissionMode: true })
  .partial({ workflowId: true })
  .strict();

export function completeAssistantTaskInput(given: Record<string, unknown>, workflows: WorkflowsService) {
  const { functionalTest, workflowId, requirements, ...rest } = parseInput(assistantTaskInputSchema, given);
  const id =
    workflowId ?? (functionalTest === undefined ? undefined : workflows.latest(FUNCTIONAL_TEST_WORKFLOW_KEY).id);
  const input = parseInput(createTaskRequestSchema, { ...rest, workflowId: id, functionalTest, requirements });
  if ((workflows.get(input.workflowId).key === FUNCTIONAL_TEST_WORKFLOW_KEY) !== (functionalTest !== undefined)) {
    throw new AppError(
      ErrorCode.ValidationFailed,
      'Choose the functional testing workflow together with its test scope',
      {
        issues: [
          functionalTest === undefined
            ? {
                path: ['functionalTest'],
                message: 'Supply target, writes and caseAttachmentIds for functional testing',
              }
            : { path: ['workflowId'], message: 'Omit workflowId to select the built-in functional testing workflow' },
        ],
      },
    );
  }
  if (functionalTest === undefined || requirements === undefined) return input;
  const criteria = requirements.map(
    ({ title, expected, required }) => `- ${title}（${required ? '必验' : '可选'}）：${expected}`,
  );
  return parseInput(createTaskRequestSchema, {
    ...rest,
    workflowId: id,
    functionalTest,
    requirement: `${rest.requirement}\n\n功能验收条件\n${criteria.join('\n')}`,
  });
}
