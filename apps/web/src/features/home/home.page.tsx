import type { AssistantConversationDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { MarkNodes, Wordmark } from '../../components/workflow-mark.tsx';
import { formatDateTime } from '../../copy/common.ts';
import { HOME_COPY as C } from '../../copy/home.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { conversationsQuery } from '../assistant/assistant.queries.ts';
import { ConversationMenu, titleOf } from '../assistant/conversation-menu.tsx';
import { MessageList } from '../assistant/message-list.tsx';
import { useAsk } from '../assistant/use-ask.ts';
import { Character } from '../companion/character.tsx';
import { projectsQuery } from '../projects/projects.queries.ts';
import styles from './home.module.css';
import { HomeComposer } from './home-composer.tsx';
import { WorkOverview } from './work-overview.tsx';
import { WorkRail } from './work-rail.tsx';

/** How many conversations the idle home page lists by name (28 §2.1); the rest are under「全部对话」. */
const RECENT_SHOWN = 3;

const route = getRouteApi(ROUTE_IDS.home);

function Suggestions() {
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
            onClick={() => ask(text, undefined)}
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
    <nav className={styles.strip} aria-label={C.recent}>
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
      <button type="button" className={`${styles.allConversations} grow`} popoverTarget={id}>
        {C.allConversations}
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
  // The panel shows the same conversation once the user leaves the page (D112).
  useEffect(() => {
    useUiStore.setState({ activeConversationId: conversation.id });
  }, [conversation.id]);
  return (
    <div className={styles.conversation}>
      <div className={styles.conversationMain}>
        <header className={styles.conversationHead}>
          <Character mood={conversation.busy ? 'thinking' : undefined} />
          <ConversationMenu
            conversations={conversations}
            active={conversation}
            onSelect={(id) =>
              void navigate({ to: ROUTES.home, search: (s) => ({ projectId: s.projectId, conversation: id }) })
            }
          />
          <span className="grow" />
          <Link to={ROUTES.home} search={(s) => ({ projectId: s.projectId })} className="btn sm">
            <Icon name="plus" size="sm" />
            {C.newConversation}
          </Link>
        </header>
        <div className={styles.stream} data-testid="home-messages">
          <MessageList key={conversation.id} conversation={conversation} />
        </div>
        {composer}
      </div>
      <WorkRail />
    </div>
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
  const navigate = route.useNavigate();
  const projectId = projects.some((p) => p.id === search.projectId) ? search.projectId : projects[0]?.id;
  const list = conversations.data ?? [];
  const conversation = list.find((c) => c.id === search.conversation);

  const composer = (
    <HomeComposer
      // A new prefill in the address (the assistant's open_form, the report card) starts the input over.
      key={`${search.conversation}|${search.workflow}|${search.requirement}`}
      conversation={conversation}
      projects={projects}
      projectId={projectId ?? ''}
      onProjectChange={(id) => void navigate({ search: (s) => ({ ...s, projectId: id }), replace: true })}
      initialWorkflowKey={search.workflow}
      initialRequirement={search.requirement}
      docked={conversation !== undefined}
    />
  );

  if (conversation !== undefined) {
    return <HomeConversation conversation={conversation} conversations={list} composer={composer} />;
  }
  return (
    <div className="page">
      <div className={styles.hero}>
        <MarkNodes className={styles.mark} />
        <Wordmark className={styles.wordmark} />
        <p className={styles.tagline}>{C.tagline}</p>
      </div>
      <div className={styles.lead}>
        {composer}
        <Suggestions />
        {conversations.isError && (
          <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
        )}
        <RecentConversations conversations={list} />
      </div>
      <WorkOverview />
    </div>
  );
}
