import {
  AppError,
  AttemptKind,
  ErrorCode,
  investigateDatabaseDescription,
  investigateDatabaseInputSchema,
  investigateDatabaseOutputSchema,
  McpToolName,
} from '@aw/shared';
import type { AttemptsService } from '../../attempts/index.ts';
import type { DatabaseInvestigations } from '../../database-investigations/index.ts';
import type { TasksService } from '../../tasks/index.ts';
import { defineMcpTool } from '../mcp.registry.ts';

export function investigateDatabaseTool(
  service: DatabaseInvestigations,
  tasks: TasksService,
  attempts: AttemptsService,
) {
  return defineMcpTool({
    name: McpToolName.InvestigateDatabase,
    description: investigateDatabaseDescription,
    input: investigateDatabaseInputSchema,
    output: investigateDatabaseOutputSchema,
    allowedKinds: [AttemptKind.Plan, AttemptKind.Execute, AttemptKind.Review],
    handler(input, { attempt, signal }) {
      if (!attempt.taskId) throw new AppError(ErrorCode.DbConnectionNotFound, 'This session has no project database');
      const parentSignal = attempt.opencodeSessionId
        ? attempts.delegationSignal(attempt.id, attempt.opencodeSessionId)
        : undefined;
      return service.investigate({
        owner: { kind: 'task', id: attempt.taskId },
        projectId: tasks.projectIdOf(attempt.taskId),
        attemptId: attempt.id,
        input,
        ...(signal && { signal }),
        ...(parentSignal && { parentSignal }),
      });
    },
  });
}
