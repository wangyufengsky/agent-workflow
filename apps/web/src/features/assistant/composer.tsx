import type { AssistantConversationDTO } from '@aw/shared';
import { type FormEvent, type KeyboardEvent, type RefObject, useState } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import styles from './assistant.module.css';
import { useAbortAssistant } from './assistant.queries.ts';
import { useAsk } from './use-ask.ts';

/** The input at the bottom (15 §6): it grows with the text, ⌘↵ sends, and while the assistant works it can stop it. */
export function Composer({
  conversation,
  inputRef,
}: {
  conversation: AssistantConversationDTO | undefined;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState('');
  const { ask, isPending, error } = useAsk();
  const abort = useAbortAssistant();
  const busy = conversation?.busy === true;
  const empty = text.trim() === '';

  const submit = (e: FormEvent | KeyboardEvent) => {
    e.preventDefault();
    if (empty || busy) return;
    ask(text.trim(), conversation, () => setText(''));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e);
  };

  return (
    <form className={styles.composer} onSubmit={submit}>
      {error !== null && <ErrorState error={error} />}
      <div className={styles.inputBox}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          aria-label={C.inputLabel}
          placeholder={C.inputPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={styles.inputRow}>
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
              disabled={empty || isPending}
            >
              {isPending ? <span className="spin" aria-hidden="true" /> : <Icon name="arrowUp" size="sm" />}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
