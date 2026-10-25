import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  attemptMachine,
  createInitiativeOp,
  type InitiativeDetailDTO,
  initiativeDetailSchema,
  isTerminalState,
  openInitiativePhaseOp,
  RuntimeStatus,
  rebreakdownInitiativeOp,
  refineInitiativeOp,
  ServerEventType,
} from '@aw/shared';
import { and, eq } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db, DbExecutor } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { OperationImpl } from '../../core/operations/operations.ts';
import type { InitiativesService } from '../initiatives/index.ts';
import type { AssistantService } from './assistant.service.ts';
import { assistantBreakdownFollowupsTable } from './assistant.table.ts';

/** The operations that start an AI run of an initiative: a breakdown, a new one, a refinement (34 §8). */
const STARTS_RUN: ReadonlySet<string> = new Set([
  createInitiativeOp.id,
  rebreakdownInitiativeOp.id,
  refineInitiativeOp.id,
  openInitiativePhaseOp.id,
]);

type Followup = { attemptId: string; initiativeId: string; conversationId: string };

function createFollowupsRepo(db: DbExecutor) {
  const f = assistantBreakdownFollowupsTable;
  return {
    insert(followup: Followup, createdAt: number): void {
      db.insert(f)
        .values({ ...followup, createdAt })
        .run();
    },
    pending(initiativeId?: string): Followup[] {
      const open = eq(f.reported, false);
      return db
        .select({ attemptId: f.attemptId, initiativeId: f.initiativeId, conversationId: f.conversationId })
        .from(f)
        .where(initiativeId === undefined ? open : and(open, eq(f.initiativeId, initiativeId)))
        .all();
    },
    report(attemptId: string): void {
      db.update(f).set({ reported: true }).where(eq(f.attemptId, attemptId)).run();
    },
  };
}

/** What the assistant is told about a run that ended; titles and texts come from the model and stay data. */
function snapshotOf(initiative: InitiativeDetailDTO) {
  const run = initiative.latestRun;
  const titles = new Map(initiative.items.map((item) => [item.key, item.title]));
  return {
    initiativeId: initiative.id,
    key: initiative.key,
    title: initiative.title,
    status: initiative.status,
    mode: run?.mode ?? null,
    openPhase: run?.openPhase ?? null,
    run: run === null ? null : { status: run.status, error: run.error },
    link: `/initiatives/${encodeURIComponent(initiative.id)}`,
    summary: initiative.summary,
    understanding: initiative.understanding,
    phases: initiative.phases.map((phase, index) => ({
      title: phase.title,
      goal: phase.goal,
      items: initiative.items
        .filter((item) => item.phase === index + 1)
        .map((item) => ({
          key: item.key,
          title: item.title,
          workflow: item.workflowName ?? item.workflow,
          dependsOn: item.dependsOn,
          status: item.status,
        })),
    })),
    // Matched with the work packages as they are now (34 §5.2): a point whose packages are gone is not covered.
    coverage:
      initiative.coverage === null
        ? null
        : {
            points: initiative.coverage.length,
            uncovered: initiative.coverage
              .filter((line) => !line.items.some((key) => titles.has(key)))
              .map((line) => line.point),
          },
  };
}

/**
 * AI runs of initiatives the assistant started (34 §10): which conversation asked for each, and once the run ends,
 * its outcome goes back to that conversation as the next message, like a member analysis (33 §6). A run the user
 * replaced on the page before it ended is not reported.
 */
export function createBreakdownRelay(deps: {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  events: EventBus;
  log: Logger;
  initiatives: InitiativesService;
  conversations: AssistantService;
  prompts: Prompts;
}) {
  const { unit, conversations, clock, log, initiatives } = deps;
  const repo = createFollowupsRepo(deps.db);
  let started = false;
  /** Conversations given an outcome before the app started sending: sent on start. */
  const waiting = new Set<string>();

  async function flush(conversationId: string): Promise<void> {
    try {
      await conversations.flush(conversationId);
    } catch (err) {
      // The message stays in the conversation's outbox; it is sent on the next reconnect, start or message.
      log.error({ err, conversationId }, 'initiative breakdown outcome not sent to assistant');
    }
  }

  function reconcile(initiativeId?: string): void {
    const recipients = unit.transact(() => {
      const recipients = new Set<string>();
      for (const followup of repo.pending(initiativeId)) {
        const initiative = initiatives.detail(followup.initiativeId);
        const run = initiative.latestRun;
        if (run?.attemptId === followup.attemptId && !isTerminalState(attemptMachine, run.status)) continue;
        if (run?.attemptId === followup.attemptId) {
          conversations.queueMessage(
            followup.conversationId,
            renderTemplate(deps.prompts[PromptName.AssistantBreakdown], {
              snapshot: JSON.stringify(snapshotOf(initiative), null, 2),
            }),
          );
          recipients.add(followup.conversationId);
        }
        repo.report(followup.attemptId);
      }
      return recipients;
    });
    for (const id of recipients) {
      if (started) void flush(id);
      else waiting.add(id);
    }
  }

  deps.events.subscribe((event) => {
    if (event.type === ServerEventType.InitiativeUpdated) reconcile(event.data.initiativeId);
    if (started && event.type === ServerEventType.RuntimeUpdated && event.data.status === RuntimeStatus.Ready) {
      for (const { conversationId } of repo.pending()) void flush(conversationId);
    }
  });
  reconcile();

  return {
    async start(): Promise<void> {
      started = true;
      await Promise.all([...waiting].map(flush));
      waiting.clear();
    },
    /** Runs the operation for a conversation and, when it started an AI run, remembers who to report back to. */
    async run(conversationId: string, impl: OperationImpl, input: unknown): Promise<unknown> {
      const output = await impl.run(input);
      const initiative = initiativeDetailSchema.parse(output);
      const run = initiative.latestRun;
      if (run !== null && !isTerminalState(attemptMachine, run.status)) {
        unit.transact(() => {
          conversations.get(conversationId);
          repo.insert({ attemptId: run.attemptId, initiativeId: initiative.id, conversationId }, clock.now());
        });
        // A run can end before it is recorded here (a session that fails to start).
        reconcile(initiative.id);
      }
      return output;
    },
    handles: (impl: OperationImpl) => STARTS_RUN.has(impl.contract.id),
  };
}
export type BreakdownRelay = ReturnType<typeof createBreakdownRelay>;
