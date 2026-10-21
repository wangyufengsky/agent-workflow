import { ErrorState } from '../../components/error-state.tsx';
import { ASSISTANT_COPY } from '../../copy/assistant.ts';
import { useUiStore } from '../../state/ui.store.ts';
import styles from './assistant.module.css';
import { useAsk } from './use-ask.ts';

const C = ASSISTANT_COPY.home;

/**
 * The assistant's place on the home page (15 §1, D84): a strip under「开始任务」rather than a second input above it.
 * Development tasks go through the form; the strip opens the panel, or asks one of the suggestions in a new
 * conversation there.
 */
export function HomeAssistantEntry() {
  const { ask, isPending, error } = useAsk();
  return (
    <section className={styles.homeEntry} aria-label={C.title}>
      <span className={styles.orb} aria-hidden="true" />
      <div className={styles.homeText}>
        <h2 className={styles.homeTitle}>{C.title}</h2>
        <p className={styles.homeBody}>{C.body}</p>
      </div>
      <fieldset className={styles.homeSuggestions}>
        <legend className="sr">{C.suggestionsLabel}</legend>
        {ASSISTANT_COPY.suggestions.slice(0, 3).map((text) => (
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
      <button type="button" className={styles.homeOpen} onClick={() => useUiStore.setState({ assistantOpen: true })}>
        {C.open}
        <span className="kbd">{ASSISTANT_COPY.shortcut}</span>
      </button>
      {error !== null && <ErrorState error={error} />}
    </section>
  );
}
