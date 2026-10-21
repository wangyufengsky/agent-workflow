import type { AssistantConversationDTO } from '@aw/shared';
import { ErrorState } from '../../components/error-state.tsx';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';
import styles from './assistant.module.css';
import { useAsk } from './use-ask.ts';

/** A conversation with nothing in it yet: a greeting and a few things to ask, each sent with one click. */
export function AssistantWelcome({ conversation }: { conversation: AssistantConversationDTO | undefined }) {
  const { ask, isPending, error } = useAsk();
  return (
    <div className={styles.welcome}>
      <span className={styles.orb} data-size="lg" aria-hidden="true" />
      <h2 className={styles.greeting}>{C.greeting}</h2>
      <p className={styles.welcomeBody}>{C.empty}</p>
      <div className={styles.suggestions}>
        {C.suggestions.map((text) => (
          <button
            key={text}
            type="button"
            className={styles.suggestion}
            disabled={isPending}
            onClick={() => ask(text, conversation)}
          >
            {text}
          </button>
        ))}
      </div>
      {error !== null && <ErrorState error={error} />}
    </div>
  );
}
