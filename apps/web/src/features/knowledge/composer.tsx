import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import styles from './knowledge.module.css';

/** The question box (18 §2.1): Enter sends, Shift+Enter breaks the line; while researching it offers to stop. */
export function Composer({
  placeholder,
  initialText = '',
  blockedReason,
  researching,
  pending,
  onSend,
  onStop,
  children,
}: {
  placeholder: string;
  initialText?: string;
  /** Why sending is not possible now (no source selected, the previous question still researching). */
  blockedReason: string | undefined;
  researching: boolean;
  pending: boolean;
  onSend(question: string, clear: () => void): void;
  onStop?: () => void;
  /** Shown under the box: the sources. */
  children?: ReactNode;
}) {
  const [text, setText] = useState(initialText);
  const question = text.trim();
  const canSend = question !== '' && blockedReason === undefined && !pending;
  const send = () => {
    if (canSend) onSend(question, () => setText(''));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };
  return (
    <div className={styles.composerWrap}>
      <div className={styles.composer}>
        <textarea
          className={styles.composerInput}
          rows={2}
          aria-label={C.inputLabel}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={styles.composerBar}>
          <span className="hint grow">{blockedReason ?? C.inputHint}</span>
          {researching && onStop !== undefined ? (
            <Button icon="stop" onClick={onStop}>
              {C.stop}
            </Button>
          ) : (
            <Button variant="primary" icon="arrowUp" pending={pending} disabled={!canSend} onClick={send}>
              {C.send}
            </Button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
