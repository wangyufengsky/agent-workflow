import type { AssistantConversationDTO } from '@aw/shared';
import { PermissionMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, type RefObject, useState } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ATTACHMENTS_COPY } from '../../copy/attachments.ts';
import { useSetConversationPermission } from '../assistant/assistant.queries.ts';
import { AttachmentList, dropFilesInto, pasteFilesInto, useAttachmentPickers } from '../attachments/attachment-bar.tsx';
import { useAttachmentDraft } from '../attachments/use-attachment-draft.ts';
import { PermissionPicker } from '../permissions/permission-picker.tsx';
import { projectsQuery } from '../projects/projects.queries.ts';
import { useSlashSkills } from '../skills/assistant-skill-picker.tsx';
import { AddMenu } from './add-menu.tsx';
import styles from './assistant.module.css';
import { useAbortAssistant } from './assistant.queries.ts';
import { useContextAttachments } from './context-attachments.tsx';
import { ConversationProjectSelect } from './conversation-project-select.tsx';
import { UsageButton } from './usage-line.tsx';
import { useAsk } from './use-ask.ts';

/**
 * The input at the bottom (15 §6): it grows with the text, ⌘↵ sends, and while the assistant works it can stop it.
 * Two rows only — the text and a foot with「+」, usage and send (36 §2.3).
 */
export function Composer({
  conversation,
  inputRef,
  disabled = false,
  projectId,
  onProjectChange,
}: {
  conversation: AssistantConversationDTO | undefined;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** While a new conversation is being created: what is typed now must not go to the one still shown. */
  disabled?: boolean;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
}) {
  const continuation = conversation?.continuation;
  const [text, setText] = useState(continuation?.consumedAt === null ? (continuation.draftText ?? '') : '');
  const [draftMode, setDraftMode] = useState<PermissionMode>(PermissionMode.Ask);
  const changeMode = useSetConversationPermission();
  const chatMode = conversation?.permissionMode ?? draftMode;
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const projects = useQuery(projectsQuery).data ?? [];
  const files = useAttachmentDraft();
  const boundId = conversation === undefined ? projectId : conversation.projectId;
  const pickers = useAttachmentPickers(
    files,
    projects.some((p) => p.id === boundId) && boundId !== null ? { projectId: boundId, refName: 'HEAD' } : undefined,
  );
  const context = useContextAttachments(files);
  const { ask, isPending, error } = useAsk();
  const slash = useSlashSkills(inputRef, text, setText, skillIds, setSkillIds);
  const abort = useAbortAssistant();
  const busy = conversation?.busy === true;
  const empty = text.trim() === '';

  const submit = (e: FormEvent | KeyboardEvent) => {
    e.preventDefault();
    if (empty || busy || disabled || isPending || files.blocked) return;
    ask(
      text.trim(),
      conversation,
      () => {
        setText('');
        files.clear();
        setSkillIds([]);
      },
      files.ids,
      projectId,
      skillIds,
      chatMode,
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.keyDown(e)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e);
  };

  return (
    <form className={styles.composer} onSubmit={submit} {...dropFilesInto(files)}>
      {error !== null && <ErrorState error={error} />}
      <div className={styles.inputBox}>
        <ConversationProjectSelect value={boundId} projects={projects} onChange={onProjectChange} />
        {slash.panel}
        <textarea
          {...slash.props}
          ref={inputRef}
          className={styles.input}
          rows={1}
          aria-label={C.inputLabel}
          placeholder={C.inputPlaceholder}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            slash.sync(e.currentTarget);
          }}
          onKeyDown={onKeyDown}
          onPaste={pasteFilesInto(files)}
        />
        <AttachmentList draft={files} />
        <div className={styles.inputRow}>
          <AddMenu
            items={[
              { label: ATTACHMENTS_COPY.menuUpload, icon: 'paperclip', onSelect: pickers.pickFile },
              ...(pickers.pickProjectFile === undefined
                ? []
                : [
                    {
                      label: ATTACHMENTS_COPY.menuProjectFile,
                      icon: 'folder' as const,
                      onSelect: pickers.pickProjectFile,
                    },
                  ]),
              ...context.items,
            ]}
            onOpen={context.capture}
          />
          <PermissionPicker
            value={chatMode}
            disabled={changeMode.isPending}
            onChange={(permissionMode) =>
              conversation ? changeMode.mutate({ id: conversation.id, permissionMode }) : setDraftMode(permissionMode)
            }
          />
          {changeMode.isError && <ErrorState error={changeMode.error} />}
          <span className="grow" />

          {busy && conversation !== undefined ? (
            <button
              type="button"
              className={styles.send}
              data-variant="stop"
              aria-label={C.stop}
              title={C.stop}
              disabled={abort.isPending}
              onClick={() => abort.mutate(conversation.id)}
            >
              <Icon name="stop" size="sm" />
            </button>
          ) : (
            <button
              type="submit"
              className={styles.send}
              aria-label={C.send}
              title={C.send}
              disabled={empty || isPending || disabled || files.blocked}
            >
              {isPending ? <span className="spin" aria-hidden="true" /> : <Icon name="arrowUp" size="sm" />}
            </button>
          )}
        </div>
      </div>
      {conversation !== undefined && <UsageButton usage={conversation.usage} />}
      {pickers.elements}
      {context.elements}
    </form>
  );
}
