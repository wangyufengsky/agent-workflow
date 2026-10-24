import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  createTeamAnalysesOp,
  RuntimeStatus,
  ServerEventType,
  type TeamAnalysisDTO,
  TeamAnalysisStatus,
  TeamPeriod,
} from '@aw/shared';
import { and, eq } from 'drizzle-orm';
import type { Clock } from '../../core/clock.ts';
import type { Db, DbExecutor } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import { implement, type OperationImpl } from '../../core/operations/operations.ts';
import type { TeamService } from '../team/index.ts';
import type { AssistantService } from './assistant.service.ts';
import { assistantAnalysisFollowupsTable } from './assistant.table.ts';

const ENDED: readonly TeamAnalysisStatus[] = [
  TeamAnalysisStatus.Succeeded,
  TeamAnalysisStatus.Failed,
  TeamAnalysisStatus.Cancelled,
];

function createFollowupsRepo(db: DbExecutor) {
  const f = assistantAnalysisFollowupsTable;
  return {
    insert(analysisId: string, conversationId: string, createdAt: number): void {
      db.insert(f).values({ analysisId, conversationId, createdAt }).run();
    },
    pending(analysisId?: string): { analysisId: string; conversationId: string }[] {
      const open = eq(f.reported, false);
      return db
        .select({ analysisId: f.analysisId, conversationId: f.conversationId })
        .from(f)
        .where(analysisId === undefined ? open : and(open, eq(f.analysisId, analysisId)))
        .all();
    },
    report(analysisId: string): void {
      db.update(f).set({ reported: true }).where(eq(f.analysisId, analysisId)).run();
    },
  };
}

/** The member page of the analysed range, as the user opens it from a link. */
const pageLink = (a: TeamAnalysisDTO) =>
  `/team/${encodeURIComponent(a.projectId)}/members/${encodeURIComponent(a.member)}?${new URLSearchParams({
    ref: a.ref,
    period: TeamPeriod.Custom,
    from: a.from,
    to: a.to,
  })}`;

/** What the assistant is told about an analysis that ended; the report stays data (titles come from the model). */
function snapshotOf(a: TeamAnalysisDTO) {
  return {
    analysisId: a.id,
    member: a.member,
    branch: a.ref,
    from: a.from,
    to: a.to,
    status: a.status,
    error: a.error,
    link: pageLink(a),
    sample: a.sample.map((s) => ({ sha: s.sha.slice(0, 7), subject: s.subject, lines: s.lines })),
    quality: a.quality,
    report:
      a.report === null
        ? null
        : {
            summary: a.report.summary,
            workItems: a.report.work_items.map((w) => ({ title: w.title, description: w.description })),
            strengths: a.report.strengths.map((s) => s.text),
            concerns: a.report.concerns.map((c) => c.text),
            findings: a.report.findings.map((f) => ({
              severity: f.severity,
              category: f.category,
              title: f.title,
              where: `${f.commit.slice(0, 7)} ${f.path}${f.line === undefined ? '' : `:${f.line}`}`,
            })),
          },
  };
}

/**
 * Member analyses the assistant started (33 §6): which conversation asked for each, and once it ends, its report
 * goes back to that conversation as the next message, like a task's outcome (15 §6).
 */
export function createAnalysisRelay(deps: {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  events: EventBus;
  log: Logger;
  team: TeamService;
  conversations: AssistantService;
  prompts: Prompts;
}) {
  const { unit, conversations, clock, log, team } = deps;
  const repo = createFollowupsRepo(deps.db);
  let started = false;
  /** Conversations given a report before the app started sending: sent on start. */
  const waiting = new Set<string>();

  async function flush(conversationId: string): Promise<void> {
    try {
      await conversations.flush(conversationId);
    } catch (err) {
      // The message stays in the conversation's outbox; it is sent on the next reconnect, start or message.
      log.error({ err, conversationId }, 'team analysis report not sent to assistant');
    }
  }

  function reconcile(analysisId?: string): void {
    const recipients = unit.transact(() => {
      const recipients = new Set<string>();
      for (const followup of repo.pending(analysisId)) {
        const analysis = team.analyses.get(followup.analysisId);
        if (!ENDED.includes(analysis.status)) continue;
        conversations.queueMessage(
          followup.conversationId,
          renderTemplate(deps.prompts[PromptName.AssistantTeamAnalysis], {
            snapshot: JSON.stringify(snapshotOf(analysis), null, 2),
          }),
        );
        repo.report(followup.analysisId);
        recipients.add(followup.conversationId);
      }
      return recipients;
    });
    for (const id of recipients) {
      if (started) void flush(id);
      else waiting.add(id);
    }
  }

  deps.events.subscribe((event) => {
    if (event.type === ServerEventType.TeamAnalysisUpdated) reconcile(event.data.analysisId);
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
    /** Runs `team.analyses.create` for a conversation and remembers it as the one to report back to. */
    async run(conversationId: string, input: unknown): Promise<unknown> {
      return implement(createTeamAnalysesOp, async ({ members, ...query }) => {
        conversations.get(conversationId);
        const items = await team.analyses.create(query, members);
        unit.transact(() => {
          for (const item of items) repo.insert(item.id, conversationId, clock.now());
        });
        // An analysis can end before it is recorded here (a session that fails to start).
        for (const item of items) reconcile(item.id);
        return { items };
      }).run(input);
    },
    handles: (impl: OperationImpl) => impl.contract.id === createTeamAnalysesOp.id,
  };
}
export type AnalysisRelay = ReturnType<typeof createAnalysisRelay>;
