import { randomUUID } from 'node:crypto';
import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AssistantConfirmationDTO,
  AssistantConfirmationEvent,
  type AssistantConfirmationResult,
  AssistantConfirmationStatus,
  assistantConfirmationMachine,
  assistantToolName,
  ErrorCode,
  OperationRisk,
  ServerEventType,
  transition,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { OperationImpl } from '../../core/operations/operations.ts';
import type { SettingsService } from '../settings/index.ts';
import { type Confirmation, createAssistantRepo } from './assistant.repo.ts';
import type { AssistantService } from './assistant.service.ts';

export type ConfirmationsDeps = {
  db: Db;
  events: EventBus;
  clock: Clock;
  log: Logger;
  settings: SettingsService;
  prompts: Prompts;
  conversations: AssistantService;
  /** Operations the assistant can call, by id. */
  operations: ReadonlyMap<string, OperationImpl>;
};

/** Runs an operation the way its REST route would; a failure is the result the model is told about. */
export async function runOperation(
  impl: OperationImpl,
  input: unknown,
  log: Logger,
): Promise<AssistantConfirmationResult> {
  try {
    return { ok: true, output: await impl.run(input) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.toInfo() };
    log.error({ err, operationId: impl.contract.id }, 'assistant operation crashed');
    return { ok: false, error: { code: ErrorCode.InternalError, message: 'Internal error' } };
  }
}

/**
 * Calls of write and critical risk wait for the user (15 §4, D27): the tool records a pending confirmation and the
 * model ends its turn; the user's decision runs the operation here and goes back to the same session as a message.
 */
export function createConfirmations(deps: ConfirmationsDeps) {
  const { clock, log, settings, prompts, conversations, operations } = deps;
  const repo = createAssistantRepo(deps.db);

  function implOf(operationId: string): OperationImpl {
    const impl = operations.get(operationId);
    // Confirmations are only created for these operations; a missing one is a removed operation.
    if (impl === undefined) throw new Error(`Confirmation for unknown operation ${operationId}`);
    return impl;
  }

  function toDto(c: Confirmation): AssistantConfirmationDTO {
    const { contract } = implOf(c.operationId);
    return { ...c, title: contract.title, risk: contract.risk };
  }

  function get(id: string): Confirmation {
    const confirmation = repo.findConfirmation(id);
    if (confirmation === undefined) {
      throw new AppError(ErrorCode.AssistantConfirmationNotFound, `Confirmation ${id} not found`, { id });
    }
    return confirmation;
  }

  function publish(id: string): AssistantConfirmationDTO {
    const dto = toDto(get(id));
    deps.events.publish({ type: ServerEventType.AssistantConfirmation, data: dto });
    return dto;
  }

  function resolve(c: Confirmation, event: AssistantConfirmationEvent): void {
    const to = transition(assistantConfirmationMachine, c.status, event);
    repo.resolveConfirmation(c.id, c.status, to, { result: null, resolvedAt: clock.now() });
    log.info({ confirmationId: c.id, operationId: c.operationId, to }, 'assistant confirmation resolved');
  }

  return {
    list: (conversationId: string): AssistantConfirmationDTO[] => repo.listConfirmations(conversationId).map(toDto),

    request(conversationId: string, operationId: string, input: Record<string, unknown>): AssistantConfirmationDTO {
      const id = randomUUID();
      repo.insertConfirmation({
        id,
        conversationId,
        operationId,
        input,
        status: AssistantConfirmationStatus.Pending,
        createdAt: clock.now(),
      });
      conversations.recordConfirmation(conversationId, id);
      log.info({ confirmationId: id, operationId, conversationId }, 'assistant confirmation requested');
      return publish(id);
    },

    /**
     * Confirmed before the operation runs, so a second click cannot run it twice; the result follows. `alwaysAllow`
     * is for write risk only: critical calls are confirmed every time (D16, D27).
     */
    async confirm(id: string, alwaysAllow: boolean): Promise<AssistantConfirmationDTO> {
      const c = get(id);
      const impl = implOf(c.operationId);
      if (alwaysAllow && impl.contract.risk !== OperationRisk.Write) {
        throw new AppError(ErrorCode.ValidationFailed, `${c.operationId} cannot be always allowed`, {
          issues: [{ path: ['alwaysAllow'], message: `only write operations can be always allowed` }],
        });
      }
      resolve(c, AssistantConfirmationEvent.Confirm);
      if (alwaysAllow) {
        const allowed = settings.get('assistant.alwaysAllow');
        if (!allowed.includes(c.operationId)) settings.update({ 'assistant.alwaysAllow': [...allowed, c.operationId] });
      }
      publish(id);
      const result = await runOperation(impl, c.input, log);
      repo.setConfirmationResult(id, result);
      if (result.ok) conversations.recordProduced(c.conversationId, impl.contract, result.output);
      const dto = publish(id);
      await conversations.deliver(
        c.conversationId,
        renderTemplate(prompts[PromptName.AssistantConfirmed], {
          tool: assistantToolName(c.operationId),
          confirmationId: id,
          result: JSON.stringify(result, null, 2),
        }),
      );
      return dto;
    },

    async cancel(id: string): Promise<AssistantConfirmationDTO> {
      const c = get(id);
      resolve(c, AssistantConfirmationEvent.Cancel);
      const dto = publish(id);
      await conversations.deliver(
        c.conversationId,
        renderTemplate(prompts[PromptName.AssistantCancelled], {
          tool: assistantToolName(c.operationId),
          confirmationId: id,
        }),
      );
      return dto;
    },
  };
}
export type Confirmations = ReturnType<typeof createConfirmations>;
