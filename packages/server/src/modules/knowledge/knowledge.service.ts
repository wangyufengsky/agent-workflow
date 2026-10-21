import { randomUUID } from 'node:crypto';
import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  AppError,
  type AskKnowledgeRequest,
  type AttemptDTO,
  AttemptKind,
  type AttemptSummaryDTO,
  type CitationSourceDTO,
  CitationType,
  citationMarkers,
  type DbDescribeOutput,
  type DbQueryInput,
  type DbQueryOutput,
  ErrorCode,
  KNOWLEDGE_ANSWER_EXCERPT_CHARS,
  KNOWLEDGE_QUERY_ROWS,
  KNOWLEDGE_TITLE_MAX_CHARS,
  type KnowledgeConversationDTO,
  type KnowledgeConversationSummaryDTO,
  type KnowledgeSources,
  type KnowledgeTurnDTO,
  KnowledgeTurnStatus,
  knowledgeTurnStatusOf,
  type ListKnowledgeQuery,
  ServerEventType,
  SessionAgent,
  type SubmitAnswerInput,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { DatabasesService } from '../databases/index.ts';
import type { InboxService } from '../inbox/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { readCitedFile, validateCitations } from './knowledge.citations.ts';
import { type Conversation, createKnowledgeRepo, type Turn } from './knowledge.repo.ts';

export type KnowledgeServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  attempts: AttemptsService;
  projects: ProjectsService;
  databases: DatabasesService;
  inbox: InboxService;
  settings: SettingsService;
  prompts: Prompts;
};

/** Prefix of the opencode session titles of knowledge conversations (the titles show only in opencode). */
const SESSION_TITLE_PREFIX = 'Q&A';

const firstLine = (text: string) => (text.trim().split('\n')[0] ?? '').slice(0, KNOWLEDGE_TITLE_MAX_CHARS);

/** The answer's beginning as one line of plain text for the list: citation markers and Markdown marks dropped. */
function plainExcerpt(answer: string): string {
  let text = answer;
  for (const marker of citationMarkers(answer).reverse()) {
    text = text.slice(0, marker.start).trimEnd() + text.slice(marker.end);
  }
  return text
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, KNOWLEDGE_ANSWER_EXCERPT_CHARS);
}

/** Knowledge Q&A (18): conversations of research attempts in the project repository, answers with checked citations. */
export function createKnowledgeService(deps: KnowledgeServiceDeps) {
  const { unit, clock, attempts, projects, databases, inbox, settings, prompts } = deps;
  const repo = createKnowledgeRepo(deps.db);

  function mustFind(id: string): Conversation {
    const conversation = repo.findConversation(id);
    if (conversation === undefined) {
      throw new AppError(ErrorCode.KnowledgeConversationNotFound, `No knowledge conversation ${id}`, { id });
    }
    return conversation;
  }

  function turnOf(attempt: Pick<AttemptDTO, 'id'>): { turn: Turn; conversation: Conversation } {
    const turn = repo.findTurnByAttempt(attempt.id);
    // The registry only lets research attempts through, and every research attempt has its turn (18 §5.3).
    if (turn === undefined) throw new Error(`Research attempt ${attempt.id} has no knowledge turn`);
    return { turn, conversation: mustFind(turn.conversationId) };
  }

  const publish = (conversationId: string) =>
    unit.publish({ type: ServerEventType.KnowledgeUpdated, data: { conversationId } });

  const isResearching = (attempt: Pick<AttemptSummaryDTO, 'status'>) =>
    knowledgeTurnStatusOf(attempt.status) === KnowledgeTurnStatus.Researching;

  /** The conversation's turn still researching, if any; a conversation researches one question at a time. */
  function researchingTurn(conversationId: string): Turn | undefined {
    const turns = repo.listTurns(conversationId);
    const latest = turns.at(-1);
    return latest !== undefined && isResearching(attempts.get(latest.attemptId)) ? latest : undefined;
  }

  function assertIdle(conversation: Conversation): void {
    if (researchingTurn(conversation.id) !== undefined) {
      throw new AppError(ErrorCode.KnowledgeConversationBusy, 'The conversation is still researching', {
        conversationId: conversation.id,
      });
    }
  }

  function toTurnDto(turn: Turn, attempt: AttemptSummaryDTO): KnowledgeTurnDTO {
    const status = knowledgeTurnStatusOf(attempt.status);
    return {
      id: turn.id,
      seq: turn.seq,
      question: turn.question,
      status,
      attempt,
      awaitingInput: status === KnowledgeTurnStatus.Researching && inbox.listOpen({ attemptId: attempt.id }).length > 0,
      answer: turn.answer,
      citations: turn.citations,
      createdAt: turn.createdAt,
      answeredAt: turn.answeredAt,
    };
  }

  function detail(id: string): KnowledgeConversationDTO {
    const conversation = mustFind(id);
    const project = projects.getRecord(conversation.projectId);
    const turns = repo.listTurns(id);
    const summaries = attempts.summaries(turns.map((t) => t.attemptId));
    return {
      id: conversation.id,
      title: conversation.title,
      sources: conversation.sources,
      project: { id: project.id, name: project.name, databaseCount: databases.forProject(project.id).length },
      turns: turns.map((t) => toTurnDto(t, summaryOf(summaries, t))),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  function projectNameOf(list: readonly { id: string; name: string }[], projectId: string): string {
    const project = list.find((p) => p.id === projectId);
    // project_id is a foreign key with cascade, so the project exists.
    if (project === undefined) throw new Error(`Knowledge conversation project ${projectId} is missing`);
    return project.name;
  }

  function summaryOf(summaries: ReadonlyMap<string, AttemptSummaryDTO>, turn: Turn): AttemptSummaryDTO {
    const summary = summaries.get(turn.attemptId);
    // attempt_id is a foreign key, so the attempt exists.
    if (summary === undefined) throw new Error(`Turn ${turn.id} has no attempt ${turn.attemptId}`);
    return summary;
  }

  /** What the researcher may use, in its first message (18 §5.2). */
  function describeSources(conversation: Conversation): string {
    const { sources } = conversation;
    const connections = databases.forProject(conversation.projectId).map((c) => c.name);
    const yesNo = (on: boolean) => (on ? 'yes' : 'no');
    return [
      `- Code (source files): ${yesNo(sources.code)}`,
      `- Documentation (Markdown and text files, docs directories): ${yesNo(sources.docs)}`,
      `- Databases: ${sources.database ? `yes, read-only (${connections.join(', ')})` : 'no'}`,
      `- Web: ${sources.web ? 'yes' : 'no, do not use the web'}`,
    ].join('\n');
  }

  /**
   * Starts the next turn: a new session for the first question, the previous session for a follow-up, so the
   * researcher remembers what it read (18 §5.3). The attempt row is written before the session can call back, and the
   * turn right after it, before anything else runs.
   */
  async function startTurn(conversation: Conversation, question: string): Promise<void> {
    const project = projects.getRecord(conversation.projectId);
    const turns = repo.listTurns(conversation.id);
    const previous = turns.at(-1);
    const previousSession = previous === undefined ? null : attempts.get(previous.attemptId).opencodeSessionId;
    const attemptId = randomUUID();
    const started =
      previous !== undefined && previousSession !== null
        ? attempts.continueSession(previous.attemptId, {
            id: attemptId,
            prompt: renderTemplate(prompts[PromptName.ResearchFollowUp], { question }),
            agent: SessionAgent.Researcher,
            system: undefined,
          })
        : attempts.start({
            id: attemptId,
            kind: AttemptKind.Research,
            agent: SessionAgent.Researcher,
            taskId: null,
            nodeId: null,
            roleId: null,
            directory: project.repoPath,
            title: `${SESSION_TITLE_PREFIX} · ${conversation.title}`,
            model: settings.get('ai.defaultModel'),
            prompt: renderTemplate(prompts[PromptName.StartResearch], {
              projectName: project.name,
              question,
              sources: describeSources(conversation),
            }),
            web: conversation.sources.web,
          });
    const now = clock.now();
    unit.transact(() => {
      repo.insertTurn({
        id: randomUUID(),
        conversationId: conversation.id,
        seq: turns.length + 1,
        question,
        attemptId,
        createdAt: now,
      });
      repo.touchConversation(conversation.id, now);
      publish(conversation.id);
    });
    await started;
  }

  function assertDatabaseSelectable(projectId: string, sources: KnowledgeSources): void {
    if (sources.database && databases.forProject(projectId).length === 0) {
      throw new AppError(ErrorCode.ValidationFailed, 'The project has no linked database', {
        issues: [{ path: ['sources', 'database'], message: 'the project has no linked database' }],
      });
    }
  }

  /** The research attempt's project, for the database tools; none when databases are not a source (18 §5.4). */
  function databaseProject(attempt: AttemptDTO): string | undefined {
    const { conversation } = turnOf(attempt);
    return conversation.sources.database ? conversation.projectId : undefined;
  }

  function requireDatabaseProject(attempt: AttemptDTO, connection: string): string {
    const projectId = databaseProject(attempt);
    if (projectId === undefined) {
      throw new AppError(ErrorCode.DbConnectionNotFound, 'Databases are not a source of this question', { connection });
    }
    return projectId;
  }

  // Each end of a turn, and a permission request waiting or answered, changes what the conversation shows.
  attempts.onSignal(({ type, attempt }) => {
    if (attempt.kind !== AttemptKind.Research) return;
    const { conversation } = turnOf(attempt);
    if (type === 'ended') repo.touchConversation(conversation.id, clock.now());
    publish(conversation.id);
  });

  return {
    get: detail,

    /** A page of conversations, most recently updated first (18 §4). */
    list({ projectId, query, limit, cursor }: ListKnowledgeQuery): {
      items: KnowledgeConversationSummaryDTO[];
      nextCursor: string | null;
    } {
      const at = cursor === undefined ? -1 : cursor.indexOf('.');
      const after =
        cursor === undefined ? undefined : { updatedAt: Number(cursor.slice(0, at)), id: cursor.slice(at + 1) };
      const rows = repo.page({ projectId, query }, after, limit + 1);
      const page = rows.slice(0, limit);
      const turns = repo.listTurnsOf(page.map((c) => c.id));
      const latestTurns = new Map(turns.map((t) => [t.conversationId, t]));
      const summaries = attempts.summaries([...latestTurns.values()].map((t) => t.attemptId));
      const projectList = projects.list();
      const items = page.map((conversation): KnowledgeConversationSummaryDTO => {
        const latest = latestTurns.get(conversation.id);
        // A conversation is created with its first turn in one call.
        if (latest === undefined) throw new Error(`Knowledge conversation ${conversation.id} has no turn`);
        const attempt = summaryOf(summaries, latest);
        return {
          id: conversation.id,
          title: conversation.title,
          project: { id: conversation.projectId, name: projectNameOf(projectList, conversation.projectId) },
          turnCount: turns.filter((t) => t.conversationId === conversation.id).length,
          latest: {
            status: knowledgeTurnStatusOf(attempt.status),
            answerExcerpt: latest.answer === null ? null : plainExcerpt(latest.answer),
            citationCount: latest.citations.length,
            error: attempt.error,
          },
          updatedAt: conversation.updatedAt,
        };
      });
      const last = page.at(-1);
      return { items, nextCursor: rows.length > limit && last !== undefined ? `${last.updatedAt}.${last.id}` : null };
    },

    /** A new conversation and its first question (`knowledge.ask`). */
    async ask({ projectId, question, sources }: AskKnowledgeRequest): Promise<KnowledgeConversationDTO> {
      projects.getRecord(projectId);
      assertDatabaseSelectable(projectId, sources);
      attempts.requireReady();
      const now = clock.now();
      const conversation: Conversation = {
        id: randomUUID(),
        projectId,
        title: firstLine(question),
        sources,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertConversation(conversation);
      await startTurn(conversation, question);
      return detail(conversation.id);
    },

    /** The next question of a conversation whose previous one finished (`knowledge.followUp`). */
    async followUp(id: string, question: string): Promise<KnowledgeConversationDTO> {
      const conversation = mustFind(id);
      assertIdle(conversation);
      attempts.requireReady();
      await startTurn(conversation, question);
      return detail(id);
    },

    /** Stops the question being researched; the attempt's state machine rejects a turn that already ended. */
    async stop(id: string): Promise<KnowledgeConversationDTO> {
      const latest = repo.listTurns(mustFind(id).id).at(-1);
      // A conversation is created with its first turn in one call.
      if (latest === undefined) throw new Error(`Knowledge conversation ${id} has no turn`);
      await attempts.abort(latest.attemptId);
      return detail(id);
    },

    /** Deletes a conversation with its turns, attempts and transcripts (18 §3). */
    delete(id: string): void {
      const conversation = mustFind(id);
      assertIdle(conversation);
      const attemptIds = repo.listTurns(id).map((t) => t.attemptId);
      unit.transact(() => {
        repo.deleteConversation(id);
        attempts.delete(attemptIds);
        publish(id);
      });
    },

    /** Deleting a project (by the tasks module, 10 §5): none of its conversations may be researching. */
    assertProjectIdle(projectId: string): void {
      for (const id of repo.listConversationIds(projectId)) assertIdle(mustFind(id));
    },

    /** Within the project deletion's transaction: the conversations go with the project, their attempts here. */
    deleteByProject(projectId: string): void {
      const ids = repo.listConversationIds(projectId);
      const attemptIds = repo.listTurnsOf(ids).map((t) => t.attemptId);
      for (const id of ids) repo.deleteConversation(id);
      attempts.delete(attemptIds);
    },

    /** The original behind one citation (`knowledge.citation`, 18 §6.3). */
    async citation(turnId: string, index: number): Promise<CitationSourceDTO> {
      const turn = repo.findTurn(turnId);
      const citation = turn?.citations[index - 1];
      if (turn === undefined || citation === undefined) {
        throw new AppError(ErrorCode.KnowledgeCitationNotFound, `No citation ${index} in turn ${turnId}`, {
          turnId,
          index,
        });
      }
      const { projectId } = mustFind(turn.conversationId);
      switch (citation.type) {
        case CitationType.File:
          return readCitedFile(projects.getRecord(projectId).repoPath, citation);
        case CitationType.Database:
          return {
            ...citation,
            result: await databases.query(projectId, citation.connection, citation.sql, KNOWLEDGE_QUERY_ROWS),
          };
        case CitationType.Web:
          return citation;
      }
    },

    /** `submit_answer` (18 §5.3): the citations are checked, then the answer is stored and the attempt finishes. */
    async submitAnswer(attempt: AttemptDTO, input: SubmitAnswerInput): Promise<void> {
      const { turn, conversation } = turnOf(attempt);
      const project = projects.getRecord(conversation.projectId);
      const citations = await validateCitations(input, {
        repoPath: project.repoPath,
        sources: conversation.sources,
        connections: databases.forProject(project.id).map((c) => c.name),
      });
      unit.transact(() => {
        repo.setAnswer(turn.id, { answer: input.answer, citations, answeredAt: clock.now() });
        attempts.markSubmitted(attempt.id);
      });
    },

    /** `db_list_connections` for a research attempt (18 §5.4). */
    dbConnections(attempt: AttemptDTO) {
      const projectId = databaseProject(attempt);
      const connections = projectId === undefined ? [] : databases.forProject(projectId);
      return { connections: connections.map((c) => ({ name: c.name, type: c.type, database: c.database })) };
    },
    dbDescribe(attempt: AttemptDTO, connection: string, table: string | undefined): Promise<DbDescribeOutput> {
      return databases.describe(requireDatabaseProject(attempt, connection), connection, table);
    },
    dbQuery(attempt: AttemptDTO, { connection, sql, limit }: DbQueryInput): Promise<DbQueryOutput> {
      return databases.query(requireDatabaseProject(attempt, connection), connection, sql, limit);
    },
  };
}
export type KnowledgeService = ReturnType<typeof createKnowledgeService>;
