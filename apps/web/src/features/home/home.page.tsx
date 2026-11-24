import {
  type AssistantConversationDTO,
  AssistantForm,
  attachmentIdsSchema,
  browserTestScopeSchema,
  functionalTestScopeSchema,
  TaskStatus,
  WorktreeStatus,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { MarkNodes, Wordmark } from '../../components/workflow-mark.tsx';
import { ASSISTANT_BROWSER_COPY } from '../../copy/assistant.ts';
import { formatDateTime } from '../../copy/common.ts';
import { HOME_COPY as C } from '../../copy/home.ts';
import { usePendingForm, useUiStore } from '../../state/ui.store.ts';
import { conversationsQuery } from '../assistant/assistant.queries.ts';
import { ConversationContinuation } from '../assistant/conversation-continuation.tsx';
import { ConversationMenu, titleOf } from '../assistant/conversation-menu.tsx';
import { ConversationProjectSelect } from '../assistant/conversation-project-select.tsx';
import { MessageList } from '../assistant/message-list.tsx';
import { UsageButton } from '../assistant/usage-line.tsx';
import { useAsk } from '../assistant/use-ask.ts';
import { attachmentQuery } from '../attachments/attachments.api.ts';
import { Character } from '../companion/character.tsx';
import { MyPreview } from '../preview/my-preview.tsx';
import { previewQuery } from '../preview/preview.queries.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import { taskQuery, tasksQuery } from '../tasks/tasks.queries.ts';
import styles from './home.module.css';
import { HomeComposer } from './home-composer.tsx';
import { WorkOverview } from './work-overview.tsx';
import { WorkRail } from './work-rail.tsx';

/** How many conversations the idle home page lists by name (28 §2.1); the rest are under「全部对话」. */
const RECENT_SHOWN = 3;

const route = getRouteApi(ROUTE_IDS.home);

function Suggestions({ projectId }: { projectId: string | null }) {
  const { ask, isPending, error } = useAsk();
  return (
    <>
      <fieldset className={styles.strip}>
        <legend className={styles.cap}>{C.tryAsking}</legend>
        {C.suggestions.map((text) => (
          <button
            key={text}
            type="button"
            className={styles.suggestion}
            disabled={isPending}
            onClick={() => ask(text, undefined, undefined, [], projectId)}
          >
            {text}
          </button>
        ))}
      </fieldset>
      {error !== null && <ErrorState error={error} />}
    </>
  );
}

function RecentConversations({ conversations }: { conversations: readonly AssistantConversationDTO[] }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  if (conversations.length === 0) return null;
  return (
    <nav className={`${styles.strip} ${styles.recentStrip}`} aria-label={C.recent}>
      <span className={styles.cap} aria-hidden="true">
        {C.recent}
      </span>
      {conversations.slice(0, RECENT_SHOWN).map((c) => (
        <Link
          key={c.id}
          className={styles.recent}
          to={ROUTES.home}
          search={(s) => ({ projectId: s.projectId, conversation: c.id })}
        >
          <span className="ellipsis">{titleOf(c)}</span>
          <small>{formatDateTime(c.updatedAt)}</small>
        </Link>
      ))}
      <button type="button" className={styles.allConversations} popoverTarget={id}>
        {C.allConversations}
        <span className={styles.count}>{conversations.length}</span>
        <Icon name="chevRight" size="sm" />
      </button>
      <div ref={menu} id={id} popover="auto" className={styles.menu} role="menu" aria-label={C.allConversations}>
        {conversations.map((c) => (
          <Link
            key={c.id}
            role="menuitem"
            className={styles.menuItem}
            to={ROUTES.home}
            search={(s) => ({ projectId: s.projectId, conversation: c.id })}
            onClick={() => menu.current?.hidePopover()}
          >
            <span className="ellipsis grow">{titleOf(c)}</span>
            <small>{formatDateTime(c.updatedAt)}</small>
          </Link>
        ))}
      </div>
    </nav>
  );
}

function HomePreview({ taskId }: { taskId: string }) {
  const task = useQuery(taskQuery(taskId));
  const ready = task.data?.git.worktreeStatus === WorktreeStatus.Ready;
  const preview = useQuery({ ...previewQuery(taskId), enabled: ready });
  if (task.isError || preview.isError) return <ErrorState error={task.error ?? preview.error} />;
  if (task.data !== undefined && !ready) return <p className="hint">{ASSISTANT_BROWSER_COPY.previewUnavailable}</p>;
  return task.data === undefined || preview.data === undefined ? null : (
    <MyPreview task={task.data} preview={preview.data} pro={false} active />
  );
}

/** A conversation on the home page (28 §2.1): the same message stream as the panel, the input under it, work beside. */
function HomeConversation({
  conversation,
  conversations,
  composer,
}: {
  conversation: AssistantConversationDTO;
  conversations: readonly AssistantConversationDTO[];
  composer: React.ReactNode;
}) {
  const navigate = useNavigate();
  const desktop = window.aw !== undefined;
  const [previewTaskId, setPreviewTaskId] = useState('');
  const projects = useQuery(projectsQuery).data;
  const tasks = useQuery({ ...tasksQuery(), enabled: desktop }).data;
  const previewTasks =
    tasks?.filter(
      (task) =>
        task.status !== TaskStatus.Completed &&
        task.status !== TaskStatus.Cancelled &&
        (conversation.projectId === null || task.project.id === conversation.projectId) &&
        projects?.some((project) => project.id === task.project.id && project.preview != null),
    ) ?? [];
  // The panel shows the same conversation once the user leaves the page (D112).
  useEffect(() => {
    useUiStore.setState({ activeConversationId: conversation.id });
  }, [conversation.id]);
  const select = (id: string) =>
    void navigate({ to: ROUTES.home, search: (s) => ({ projectId: s.projectId, conversation: id }) });
  return (
    <ConversationContinuation conversation={conversation} onContinued={select}>
      <div className={styles.conversation}>
        <div className={styles.conversationMain}>
          <header className={styles.conversationHead}>
            <Character mood={conversation.busy ? 'thinking' : undefined} />
            <div>
              <ConversationMenu conversations={conversations} active={conversation} onSelect={select} />
              <ConversationProjectSelect
                value={conversation.projectId}
                projects={projects ?? []}
                onChange={(id) =>
                  void navigate({
                    to: ROUTES.home,
                    search: (s) => ({ ...s, conversation: undefined, assistantProjectId: id ?? undefined }),
                    replace: true,
                  })
                }
              />
            </div>
            <span className="grow" />
            {desktop && previewTasks.length > 0 && (
              <select
                className="input"
                aria-label={ASSISTANT_BROWSER_COPY.preview}
                value={previewTaskId}
                onChange={(event) => setPreviewTaskId(event.target.value)}
              >
                <option value="">
                  {previewTaskId === '' ? ASSISTANT_BROWSER_COPY.preview : ASSISTANT_BROWSER_COPY.closePreview}
                </option>
                {previewTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.key} · {task.title}
                  </option>
                ))}
              </select>
            )}
            <Link to={ROUTES.home} search={(s) => ({ projectId: s.projectId })} className="btn sm">
              <Icon name="plus" size="sm" />
              {C.newConversation}
            </Link>
          </header>
          <div className={styles.stream} data-testid="home-messages">
            <MessageList key={conversation.id} conversation={conversation} />
            <UsageButton usage={conversation.usage} />
          </div>
          {composer}
        </div>
        {previewTaskId === '' ? (
          <WorkRail />
        ) : (
          <aside className={styles.preview} aria-label={ASSISTANT_BROWSER_COPY.preview}>
            <HomePreview key={previewTaskId} taskId={previewTaskId} />
          </aside>
        )}
      </div>
    </ConversationContinuation>
  );
}

/**
 * Home (28 §2, D111): the assistant first. Idle, the hero and the one input, with suggestions, recent conversations
 * and the work overview under it; with `?conversation=` the page is that conversation, the work beside it.
 */
export function HomePage() {
  const projects = useQuery(projectsQuery).data ?? [];
  const conversations = useQuery(conversationsQuery);
  const search = route.useSearch();
  const pendingForm = usePendingForm(AssistantForm.StartTask);
  const form = pendingForm?.seq === search.formSeq ? pendingForm?.values : undefined;
  const browserTest = browserTestScopeSchema.optional().parse(form?.browserTest);
  const formScope = functionalTestScopeSchema.optional().parse(form?.functionalTest);
  const functionalTestAttachmentIds =
    formScope === undefined ? undefined : attachmentIdsSchema.optional().parse(form?.attachmentIds);
  const navigate = route.useNavigate();
  const material = useQuery({
    ...attachmentQuery(search.knowledgeMaterial ?? ''),
    enabled: search.knowledgeMaterial !== undefined,
  });
  const origin = material.data?.origin;
  const knowledgeOrigin = origin != null && 'kind' in origin ? origin : undefined;
  const projectId =
    search.knowledgeMaterial === undefined
      ? search.moduleId !== undefined ||
        search.compoundId !== undefined ||
        projects.some((p) => p.id === search.projectId)
        ? search.projectId
        : projects[0]?.id
      : projects.find((project) => project.id === knowledgeOrigin?.projectId)?.id;
  const defaultScope = { target: '/', writes: [], caseAttachmentIds: [] };
  const functionalTest =
    search.compoundId !== undefined
      ? {
          ...(formScope ?? defaultScope),
          compoundSelection: {
            compoundId: search.compoundId,
            fingerprint: search.compoundFingerprint ?? '',
            targetServiceId: search.targetServiceId,
          },
          moduleSelection: undefined,
        }
      : search.moduleId
        ? {
            ...(formScope ?? defaultScope),
            moduleSelection: {
              moduleId: search.moduleId,
              configurationId: search.configurationId,
              fingerprint: search.configurationFingerprint,
            },
            compoundSelection: undefined,
          }
        : formScope;
  const list = conversations.data ?? [];
  const conversation = list.find((c) => c.id === search.conversation);

  const composer = (
    <HomeComposer
      // A new prefill in the address (the assistant's open_form, the report card) starts the input over.
      key={`${search.conversation}|${search.workflow}|${search.requirement}|${search.formSeq}|${search.moduleId}|${search.configurationId}|${search.configurationFingerprint}|${search.compoundId}|${search.compoundFingerprint}|${search.targetServiceId}`}
      conversation={conversation}
      projects={projects}
      projectId={projectId ?? ''}
      assistantProjectId={search.assistantProjectId ?? null}
      onAssistantProjectChange={(id) =>
        void navigate({
          search: (s) => ({ ...s, conversation: undefined, assistantProjectId: id ?? undefined }),
          replace: true,
        })
      }
      onProjectChange={(id) =>
        void navigate({
          search: (s) => ({
            ...s,
            projectId: id,
            moduleId: undefined,
            configurationId: undefined,
            configurationFingerprint: undefined,
            compoundId: undefined,
            compoundFingerprint: undefined,
            targetServiceId: undefined,
          }),
          replace: true,
        })
      }
      initialWorkflowKey={search.workflow}
      initialRequirement={search.requirement}
      initialBrowserTest={browserTest}
      initialFunctionalTest={functionalTest}
      initialFunctionalTestAttachmentIds={functionalTestAttachmentIds}
      knowledgeDraft={
        search.knowledgeMaterial === undefined
          ? undefined
          : {
              attachment: knowledgeOrigin === undefined ? undefined : material.data,
              loading: material.isPending,
              error: material.error,
              retry: () => void material.refetch(),
              dismiss: () => void navigate({ search: (s) => ({ ...s, knowledgeMaterial: undefined }), replace: true }),
            }
      }
      docked={conversation !== undefined}
    />
  );

  if (conversation !== undefined) {
    return (
      <HomeConversation key={conversation.id} conversation={conversation} conversations={list} composer={composer} />
    );
  }
  return (
    <div className={`page ${styles.idle}`}>
      <div className={styles.welcome}>
        <div className={styles.hero}>
          <MarkNodes className={styles.mark} />
          <Wordmark className={styles.wordmark} />
          <p className={styles.tagline}>{C.tagline}</p>
        </div>
        <div className={styles.lead}>
          {composer}
          <Suggestions projectId={search.assistantProjectId ?? null} />
          {conversations.isError && (
            <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
          )}
          <RecentConversations conversations={list} />
        </div>
      </div>
      <WorkOverview />
    </div>
  );
}
