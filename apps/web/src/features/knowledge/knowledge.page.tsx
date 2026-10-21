import {
  answerDraft,
  type KnowledgeConversationDTO,
  type KnowledgeTurnDTO,
  KnowledgeTurnStatus,
  UiMode,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import { PPT_COPY } from '../../copy/ppt.ts';
import { attemptQuery, attemptTranscript, useTranscript } from '../attempts/attempt.queries.ts';
import { TranscriptView } from '../attempts/transcript-view.tsx';
import { projectQuery, projectsQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import { Answer, DraftAnswer } from './answer.tsx';
import { Composer } from './composer.tsx';
import styles from './knowledge.module.css';
import { knowledgeConversationQuery, useAskKnowledge, useFollowUp, useStopKnowledge } from './knowledge.queries.ts';
import { ModelPicker } from './model-picker.tsx';
import { ResearchCard } from './research-card.tsx';
import { SourcePanel } from './source-panel.tsx';
import { DEFAULT_SOURCES, hasSource, SourcesPicker } from './sources-picker.tsx';

const welcomeRoute = getRouteApi(ROUTE_IDS.knowledge);
const conversationRoute = getRouteApi(ROUTE_IDS.knowledgeConversation);

function TopBar({ project, locked, conversationId }: { project?: string; locked: boolean; conversationId?: string }) {
  return (
    <div className={styles.topBar}>
      {project !== undefined && (
        <span className="chip" title={locked ? C.projectLocked : undefined}>
          <Icon name={locked ? 'lock' : 'folder'} size="sm" />
          {project}
        </span>
      )}
      <span className="grow" />
      {conversationId !== undefined && (
        // 23 §2.5: what was found, as a PPT.
        <Link to={ROUTES.pptNew} search={{ knowledgeConversationId: conversationId }} className="btn ghost sm">
          <Icon name="slides" size="sm" />
          {PPT_COPY.makeDeck}
        </Link>
      )}
      <Link to={ROUTES.knowledgeHistory} className="btn ghost sm">
        <Icon name="clock" size="sm" />
        {C.history}
      </Link>
      {locked && (
        <Link to={ROUTES.knowledge} className="btn sm">
          <Icon name="plus" size="sm" />
          {C.newConversation}
        </Link>
      )}
    </div>
  );
}

/** First screen (18 §2.1): the project, the question box with its sources, and example questions. */
export function KnowledgeWelcomePage() {
  const projects = useQuery(projectsQuery).data ?? [];
  const search = welcomeRoute.useSearch();
  const navigate = useNavigate();
  const projectId = projects.some((p) => p.id === search.projectId) ? search.projectId : projects[0]?.id;
  const detail = useQuery({ ...projectQuery(projectId ?? ''), enabled: projectId !== undefined });
  const databaseCount = detail.data?.dbConnectionIds.length ?? 0;
  const [chosen, setSources] = useState(DEFAULT_SOURCES);
  // A project without linked databases cannot have them as a source, whatever was ticked for another project.
  const sources = { ...chosen, database: chosen.database && databaseCount > 0 };
  const [example, setExample] = useState<string | undefined>(undefined);
  const [model, setModel] = useState(useSettings()['ai.defaultModel']);
  const ask = useAskKnowledge();

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <TopBar locked={false} />
        <div className={styles.welcome}>
          <span className={styles.avatar} aria-hidden="true">
            <Icon name="book" size="lg" />
          </span>
          <p className="eyebrow">
            {C.researcher} · {C.readOnly}
          </p>
          <h2 className={styles.welcomeTitle}>{C.welcomeTitle}</h2>
          <p className="lede">{C.welcomeBody}</p>
          {projects.length > 1 && (
            <label className={styles.projectPick}>
              <span className="label">{C.project}</span>
              <select
                className="select"
                value={projectId}
                onChange={(e) =>
                  void navigate({ to: ROUTES.knowledge, search: { projectId: e.target.value }, replace: true })
                }
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Composer
            key={example}
            placeholder={C.inputPlaceholder}
            initialText={example ?? ''}
            blockedReason={hasSource(sources) ? undefined : C.needSource}
            researching={false}
            pending={ask.isPending}
            tools={<ModelPicker value={model} onChange={setModel} />}
            onSend={(question) => {
              if (projectId === undefined) return;
              ask.mutate(
                { projectId, question, sources, model },
                {
                  onSuccess: (c) =>
                    void navigate({ to: ROUTES.knowledgeConversation, params: { conversationId: c.id } }),
                },
              );
            }}
          >
            <SourcesPicker sources={sources} databaseCount={databaseCount} onChange={setSources} />
          </Composer>
          {ask.isError && <ErrorState error={ask.error} />}
          <div className={styles.examples}>
            <span className="hint">{C.examplesTitle}</span>
            {C.examples.map((text) => (
              <button key={text} type="button" className={styles.example} onClick={() => setExample(text)}>
                <Icon name="chevRight" size="sm" />
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pro view of a turn: its session stream, model and usage. */
function TurnDetails({ attemptId }: { attemptId: string }) {
  const attempt = useQuery(attemptQuery(attemptId)).data;
  return (
    <details className={styles.turnDetails}>
      <summary className="hint">{C.transcript}</summary>
      {attempt !== undefined && (
        <p className="hint">
          {C.model(attempt.model)} · {C.usage(attempt.tokensInput, attempt.tokensOutput, attempt.cost)}
        </p>
      )}
      <TranscriptView attemptId={attemptId} />
    </details>
  );
}

function Turn({
  turn,
  repoPath,
  pro,
  isLatest,
  activeCitation,
  onCite,
  onAskAgain,
}: {
  turn: KnowledgeTurnDTO;
  repoPath: string;
  pro: boolean;
  isLatest: boolean;
  activeCitation: number | undefined;
  onCite(index: number, trigger: HTMLElement): void;
  onAskAgain(): void;
}) {
  const ended = turn.status === KnowledgeTurnStatus.Stopped || turn.status === KnowledgeTurnStatus.Failed;
  const { entries } = useTranscript(attemptTranscript(turn.attempt.id));
  // Until the checked answer replaces it, the text being written is shown as a draft (18 §5.5).
  const draft = turn.answer === null ? answerDraft(entries) : undefined;
  return (
    <article className={styles.turn} aria-label={turn.question} data-testid="knowledge-turn">
      <p className={styles.question}>{turn.question}</p>
      <div className={styles.researcherRow}>
        <span className={styles.avatarSm} aria-hidden="true">
          <Icon name="book" size="sm" />
        </span>
        <span className="label">{C.researcher}</span>
        <span className={styles.modelTag}>{C.modelOf(turn.model)}</span>
      </div>
      <ResearchCard turn={turn} entries={entries} repoPath={repoPath} />
      {draft !== undefined && <DraftAnswer draft={draft} stopped={ended} />}
      {turn.answer !== null && (
        <Answer answer={turn.answer} citations={turn.citations} active={activeCitation} onCite={onCite} />
      )}
      {ended && (
        <div className={styles.ended}>
          <span className="grow">{turn.status === KnowledgeTurnStatus.Stopped ? C.stopped : C.failed}</span>
          {isLatest && (
            <Button size="sm" icon="refresh" onClick={onAskAgain}>
              {C.askAgain}
            </Button>
          )}
        </div>
      )}
      {turn.status === KnowledgeTurnStatus.Failed && turn.attempt.error !== null && (
        <ErrorState error={turn.attempt.error} />
      )}
      {pro && <TurnDetails attemptId={turn.attempt.id} />}
    </article>
  );
}

function Conversation({ conversation }: { conversation: KnowledgeConversationDTO }) {
  const { turn: openTurn, cite, details } = conversationRoute.useSearch();
  const navigate = conversationRoute.useNavigate();
  const pro = useSettings()['ui.mode'] === UiMode.Pro || details === true;
  const followUp = useFollowUp();
  const stop = useStopKnowledge();
  const trigger = useRef<HTMLElement | null>(null);
  const latest = conversation.turns.at(-1);
  const researching = latest?.status === KnowledgeTurnStatus.Researching;
  const cited = conversation.turns.find((t) => t.id === openTurn);
  // A follow-up keeps the model of the question before it unless the user picks another one (D67 ④).
  const [model, setModel] = useState(latest?.model ?? null);

  const openCitation = (turnId: string, index: number, from?: HTMLElement) => {
    if (from !== undefined) trigger.current = from;
    void navigate({ search: (prev) => ({ ...prev, turn: turnId, cite: index }), replace: true });
  };
  const closeCitation = () => {
    void navigate({ search: (prev) => ({ ...prev, turn: undefined, cite: undefined }), replace: true });
    trigger.current?.focus();
  };
  const ask = (question: string, clear?: () => void) =>
    followUp.mutate({ id: conversation.id, question, model }, { onSuccess: () => clear?.() });

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <TopBar project={conversation.project.name} locked conversationId={conversation.id} />
        <div className={styles.scroll}>
          <div className={styles.axis}>
            {conversation.turns.map((turn) => (
              <Turn
                key={turn.id}
                turn={turn}
                repoPath={conversation.project.repoPath}
                pro={pro}
                isLatest={turn === latest}
                activeCitation={turn.id === openTurn ? cite : undefined}
                onCite={(index, from) => openCitation(turn.id, index, from)}
                onAskAgain={() => ask(turn.question)}
              />
            ))}
            {followUp.isError && <ErrorState error={followUp.error} />}
            {stop.isError && <ErrorState error={stop.error} />}
          </div>
        </div>
        <Composer
          placeholder={C.followUpPlaceholder}
          blockedReason={researching ? C.busyHint : undefined}
          researching={researching}
          pending={followUp.isPending}
          onSend={ask}
          onStop={() => stop.mutate(conversation.id)}
          tools={<ModelPicker value={model} onChange={setModel} />}
        >
          <SourcesPicker sources={conversation.sources} databaseCount={conversation.project.databaseCount} />
        </Composer>
      </div>
      {cited !== undefined && cite !== undefined && (
        <SourcePanel
          turnId={cited.id}
          citations={cited.citations}
          index={cite}
          onSelect={(index) => openCitation(cited.id, index)}
          onClose={closeCitation}
        />
      )}
    </div>
  );
}

/** One knowledge conversation (18 §2.1): every question with its research, answer and citations; follow-ups below. */
export function KnowledgeConversationPage() {
  const { conversationId } = conversationRoute.useParams();
  const conversation = useQuery(knowledgeConversationQuery(conversationId));
  if (conversation.isPending) return <p className="hint page">{COMMON_COPY.loading}</p>;
  if (conversation.isError) {
    return (
      <div className="page narrow">
        <ErrorState error={conversation.error} onRetry={() => void conversation.refetch()} />
      </div>
    );
  }
  // Keyed: another conversation starts with its own state (the model picker follows its latest turn).
  return <Conversation key={conversation.data.id} conversation={conversation.data} />;
}
