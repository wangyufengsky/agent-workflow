import type { AssistantConversationDTO } from '@aw/shared';
import { type FormEvent, type KeyboardEvent, type RefObject, useState } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import { ATTACHMENTS_COPY } from '../../copy/attachments.ts';
import { AttachmentList, dropFilesInto, pasteFilesInto, useAttachmentPickers } from '../attachments/attachment-bar.tsx';
import { useAttachmentDraft } from '../attachments/use-attachment-draft.ts';
import { AddMenu } from './add-menu.tsx';
import styles from './assistant.module.css';
import { useAbortAssistant } from './assistant.queries.ts';
import { useContextAttachments } from './context-attachments.tsx';
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
}: {
  conversation: AssistantConversationDTO | undefined;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** While a new conversation is being created: what is typed now must not go to the one still shown. */
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const files = useAttachmentDraft();
  const pickers = useAttachmentPickers(files, undefined);
  const context = useContextAttachments(files);
  const { ask, isPending, error } = useAsk();
  const abort = useAbortAssistant();
  const busy = conversation?.busy === true;
  const empty = text.trim() === '';

  const submit = (e: FormEvent | KeyboardEvent) => {
    e.preventDefault();
    if (empty || busy || disabled || files.blocked) return;
    ask(
      text.trim(),
      conversation,
      () => {
        setText('');
        files.clear();
      },
      files.ids,
    );
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e);
  };

  return (
    <form className={styles.composer} onSubmit={submit} {...dropFilesInto(files)}>
      {error !== null && <ErrorState error={error} />}
      <div className={styles.inputBox}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          aria-label={C.inputLabel}
          placeholder={C.inputPlaceholder}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={pasteFilesInto(files)}
        />
        <AttachmentList draft={files} />
        <div className={styles.inputRow}>
          <AddMenu
            items={[
              { label: ATTACHMENTS_COPY.menuUpload, icon: 'paperclip', onSelect: pickers.pickFile },
              ...context.items,
            ]}
            onOpen={context.capture}
          />
          <span className="grow" />
          {conversation !== undefined && <UsageButton usage={conversation.usage} />}
          <span className={styles.inputHint}>{C.sendHint}</span>
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
      {pickers.elements}
      {context.elements}
    </form>
  );
}
