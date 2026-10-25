import {
  AssistantConfirmationStatus,
  CompanionAppearance,
  type CompanionLayout,
  type CompanionPanel,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ExternalLink } from '../../components/external-link.tsx';
import { COMPANION_COPY as C } from '../../copy/companion.ts';
import { COMPANION_ACTION_GROUPS } from '../../copy/companion-actions.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { confirmationsQuery, conversationsQuery, useCreateConversation } from '../assistant/assistant.queries.ts';
import { AssistantWelcome } from '../assistant/assistant-welcome.tsx';
import { Composer } from '../assistant/composer.tsx';
import { ConversationMenu } from '../assistant/conversation-menu.tsx';
import { MessageList } from '../assistant/message-list.tsx';
import { useSettings, useUpdateSettings } from '../settings/settings.queries.ts';
import { Character } from './character.tsx';
import { CHARACTER_CLIPS, type CharacterMood } from './character-assets.ts';
import styles from './companion.module.css';
import { dismissCompanionNotice, useCompanionUi, useCompanionWorking } from './companion-events.ts';
import { useCompanionWhisper } from './use-companion-whisper.ts';

const IDLE_ACTIONS = COMPANION_ACTION_GROUPS.filter((group) =>
  ['小动作', '玩耍', '吃什么'].includes(group.label),
).flatMap((group) => [...group.actions]);

const ORB_ACTION_DURATION_MS = 3_000;

export function CompanionPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const conversations = useQuery(conversationsQuery);
  const selected = useUiStore((s) => s.activeConversationId);
  const conversation = selected === null ? conversations.data?.[0] : conversations.data?.find((c) => c.id === selected);
  const confirmations = useQuery({
    ...confirmationsQuery(conversation?.id ?? ''),
    enabled: conversation !== undefined,
  });
  const create = useCreateConversation();
  const [chat, setChat] = useState(false);
  const [menu, setMenu] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [orbAction, setOrbAction] = useState<CharacterMood>('idle');
  const [idle, setIdle] = useState<string>(CHARACTER_CLIPS.idle);
  const [dragging, setDragging] = useState(false);
  const notices = useCompanionUi((s) => s.notices);
  const notificationError = useCompanionUi((s) => s.error);
  const working = useCompanionWorking();
  const [error, setError] = useState<unknown>(null);
  const [layout, setLayout] = useState<CompanionLayout | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pointer = useRef({ x: 0, y: 0, moved: false, down: false });
  const bridge = window.aw?.companion;
  const notice = notices[0];
  const whale = settings['companion.appearance'] === CompanionAppearance.Whale;
  const petSize = settings['companion.size'];
  const waiting =
    (conversation?.pendingPermissions.length ?? 0) > 0 ||
    confirmations.data?.some((c) => c.status === AssistantConfirmationStatus.Pending);
  const whisper = useCompanionWhisper(!chat && notice === undefined && !conversation?.busy && !working && !waiting);
  const panel: CompanionPanel = chat
    ? 'chat'
    : menu ||
        notice !== undefined ||
        error !== null ||
        notificationError !== null ||
        whisper.error !== null ||
        whisper.text !== null
      ? 'bubble'
      : 'none';
  useEffect(() => bridge?.onLayout(setLayout), [bridge]);
  useEffect(() => {
    if (bridge?.surface === 'companion') void bridge.setPanel(panel).catch(setError);
  }, [bridge, panel]);
  const mood: CharacterMood = dragging
    ? 'dragging'
    : (notice?.mood ??
      (waiting
        ? 'waiting'
        : conversation?.busy
          ? 'thinking'
          : working
            ? 'working'
            : whisper.pending
              ? 'thinking'
              : whisper.text !== null
                ? 'speaking'
                : whale
                  ? 'idle'
                  : orbAction));

  useEffect(() => {
    document.documentElement.dataset.companion = 'true';
    return () => {
      delete document.documentElement.dataset.companion;
    };
  }, []);
  useEffect(() => {
    if (chat) input.current?.focus();
  }, [chat]);
  useEffect(() => {
    if (orbAction === 'idle') return;
    const timer = window.setTimeout(() => setOrbAction('idle'), ORB_ACTION_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [orbAction]);

  const openMain = (path?: string) => {
    if (bridge !== undefined) void bridge.openMain(path).catch(setError);
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    pointer.current.down = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    bridge?.endDrag();
    setDragging(false);
  };
  return (
    <div
      className={styles.surface}
      data-native={bridge?.surface === 'companion'}
      data-side={layout?.side}
      onPointerMove={(event) => {
        const target = event.target;
        bridge?.setInteractive(
          pointer.current.down || (target instanceof Element && target.closest('[data-interactive]') !== null),
        );
      }}
      onPointerLeave={() => {
        if (!pointer.current.down) bridge?.setInteractive(false);
      }}
    >
      <div
        className={styles.panels}
        hidden={panel === 'none'}
        style={
          layout?.panel === null || layout === null
            ? undefined
            : {
                left: layout.panel.x,
                top: layout.panel.y,
                width: layout.panel.width,
                height: layout.panel.height,
              }
        }
      >
        {chat && (
          <section className={styles.chat} role="dialog" aria-label={C.chat} data-interactive>
            <header className={styles.header}>
              {conversation !== undefined && (
                <ConversationMenu
                  conversations={conversations.data ?? []}
                  active={conversation}
                  onSelect={(id) => useUiStore.getState().setActiveConversation(id)}
                />
              )}
              <Button
                size="sm"
                pending={create.isPending}
                onClick={() =>
                  create.mutate(undefined, { onSuccess: (c) => useUiStore.getState().setActiveConversation(c.id) })
                }
              >
                {C.newConversation}
              </Button>
              <Button size="sm" onClick={() => setChat(false)}>
                {C.closeChat}
              </Button>
            </header>
            <div className={styles.messages}>
              {conversations.isError && <ErrorState error={conversations.error} />}
              {conversation === undefined ? (
                <AssistantWelcome conversation={undefined} />
              ) : (
                <MessageList key={conversation.id} conversation={conversation} />
              )}
            </div>
            <Composer conversation={conversation} inputRef={input} disabled={create.isPending} />
          </section>
        )}
        {notice !== undefined && (
          <section className={styles.bubble} role="status" data-interactive>
            <strong>{notice.title}</strong>
            <p>{notice.body}</p>
            <div className="row">
              <Button size="sm" onClick={() => openMain(notice.path)}>
                {C.details}
              </Button>
              <Button size="sm" onClick={dismissCompanionNotice}>
                {notices.length > 1 ? `${C.next} (${notices.length - 1})` : C.dismiss}
              </Button>
            </div>
          </section>
        )}
        {error !== null && (
          <div className={styles.bubble} data-interactive>
            <ErrorState error={error} />
          </div>
        )}
        {notificationError !== null && (
          <div className={styles.bubble} data-interactive>
            <ErrorState error={notificationError} />
          </div>
        )}
        {whisper.error !== null && (
          <div className={styles.bubble} data-interactive>
            <ErrorState error={whisper.error} />
          </div>
        )}
        {whisper.text !== null && notice === undefined && (
          <section className={styles.bubble} data-interactive role="status">
            <p>{whisper.text}</p>
            <Button size="sm" onClick={whisper.dismiss}>
              {C.dismiss}
            </Button>
          </section>
        )}
        {menu && (
          <section className={styles.menu} data-interactive>
            {whale ? (
              <label className="field">
                <span>{C.actions}</span>
                <select
                  className="input"
                  value={action ?? ''}
                  onChange={(event) => {
                    setAction(event.target.value || null);
                    setMenu(false);
                  }}
                >
                  <option value="">{C.idle}</option>
                  {COMPANION_ACTION_GROUPS.map((group) => (
                    <optgroup label={group.label} key={group.label}>
                      {group.actions.map((clip) => (
                        <option key={clip} value={clip}>
                          {clip}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <fieldset className="row" aria-label={C.actions}>
                {Object.keys(CHARACTER_CLIPS)
                  .filter((key): key is CharacterMood => key in CHARACTER_CLIPS)
                  .map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      onClick={() => {
                        setOrbAction(value);
                        setMenu(false);
                      }}
                    >
                      {C.moods[value]}
                    </Button>
                  ))}
              </fieldset>
            )}
            <Button
              size="sm"
              pending={whisper.pending}
              onClick={() => {
                void whisper.speak();
                setMenu(false);
              }}
            >
              {C.speak}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setChat(true);
                setMenu(false);
              }}
            >
              {C.chat}
            </Button>
            <Button size="sm" onClick={() => openMain()}>
              {C.openApp}
            </Button>
            <Button size="sm" onClick={() => update.mutate({ 'companion.enabled': false })}>
              {C.hide}
            </Button>
            <small>
              {C.source} <ExternalLink href={C.sourceUrl}>{C.sourceLink}</ExternalLink>
            </small>
          </section>
        )}
      </div>
      <button
        type="button"
        className={styles.pet}
        data-interactive
        aria-label={C.chat}
        title={C.drag}
        style={{ width: petSize, height: Math.round(petSize * 1.2), left: layout?.actor.x, top: layout?.actor.y }}
        onContextMenu={(event) => {
          event.preventDefault();
          setChat(false);
          setMenu((open) => !open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            setChat(false);
            setMenu((open) => !open);
          }
        }}
        onPointerDown={(event) => {
          // 拖动只响应主键；右键保留动作菜单。
          if (event.button !== 0) return;
          pointer.current = { x: event.screenX, y: event.screenY, moved: false, down: true };
          event.currentTarget.setPointerCapture(event.pointerId);
          bridge?.startDrag({ x: event.screenX, y: event.screenY });
        }}
        onPointerMove={(event) => {
          if (!pointer.current.down) return;
          if (Math.hypot(event.screenX - pointer.current.x, event.screenY - pointer.current.y) > 4)
            pointer.current.moved = true;
          if (pointer.current.moved) {
            setDragging(true);
            bridge?.moveDrag({ x: event.screenX, y: event.screenY });
          }
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={() => {
          if (!pointer.current.moved) {
            setAction(CHARACTER_CLIPS.interaction);
            setOrbAction('interaction');
            setChat((open) => !open);
            setMenu(false);
          }
        }}
      >
        <Character
          mood={mood}
          size="pet"
          {...(mood !== 'idle' || !whale ? {} : action !== null ? { action } : { action: idle })}
          {...(whale && mood === 'idle'
            ? {
                onEnded: () => {
                  setAction(null);
                  const choices = IDLE_ACTIONS.filter((clip) => clip !== idle && clip !== action);
                  const next = choices[Math.floor(Math.random() * choices.length)];
                  if (next !== undefined) setIdle(next);
                },
              }
            : {})}
        />
      </button>
    </div>
  );
}
