import {
  AppError,
  assistantMemoryContentSchema,
  assistantMemoryInputSchema,
  assistantToolName,
  createAssistantMemoryOp,
  deleteAssistantMemoryOp,
  ErrorCode,
  listAssistantMemoriesOp,
  UiMode,
  updateAssistantMemoryOp,
} from '@aw/shared';
import { z } from 'zod';
import { parseInput } from '../../core/http/errors.ts';
import { implement } from '../../core/operations/operations.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { Confirmations } from './assistant.confirmations.ts';
import type { AssistantMemory } from './assistant.memory.ts';
import { type AssistantTool, NEEDS_CONFIRMATION_INSTRUCTION } from './assistant.tools.ts';

export function assistantMemoryOperations(memory: AssistantMemory) {
  return [
    implement(listAssistantMemoriesOp, () => ({ items: memory.list() })),
    implement(createAssistantMemoryOp, ({ projectId, content }) => memory.create(projectId, content)),
    implement(updateAssistantMemoryOp, ({ id, content }) => memory.update(id, content)),
    implement(deleteAssistantMemoryOp, ({ id }) => memory.delete(id)),
  ];
}

export function saveConfirmedMemory(memory: AssistantMemory, conversationId: string, input: unknown) {
  const { projectId, content } = parseInput(assistantMemoryInputSchema, input);
  return memory.create(projectId, content, conversationId);
}

const proposalSchema = z.strictObject({
  scope: z.enum(['personal', 'project']),
  content: assistantMemoryContentSchema,
});

export function proposeMemoryTool(confirmations: Confirmations, projects: ProjectsService): AssistantTool {
  return {
    name: assistantToolName(createAssistantMemoryOp.id),
    description:
      'Propose saving a short, reusable memory the user asked to keep. Project scope uses this conversation’s bound project. Saving always requires confirmation.',
    input: proposalSchema,
    mode: UiMode.Simple,
    handler(input, { conversation }) {
      const { scope, content } = parseInput(proposalSchema, input);
      const projectId = scope === 'project' ? conversation.projectId : null;
      if (scope === 'project') {
        if (projectId === null)
          throw new AppError(ErrorCode.ValidationFailed, 'Project memory requires a project-bound conversation');
        projects.getRecord(projectId);
      }
      const confirmation = confirmations.request(conversation.id, createAssistantMemoryOp.id, { projectId, content });
      return {
        status: 'needs_confirmation',
        confirmation_id: confirmation.id,
        instruction: NEEDS_CONFIRMATION_INSTRUCTION,
      };
    },
  };
}
