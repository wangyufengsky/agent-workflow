import { KnowledgeSourceKind, type KnowledgeSources } from '@aw/shared';
import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import styles from './knowledge.module.css';

const SELECTABLE = [KnowledgeSourceKind.Code, KnowledgeSourceKind.Docs, KnowledgeSourceKind.Database] as const;

export const DEFAULT_SOURCES: KnowledgeSources = { code: true, docs: true, database: false, web: false };

export const hasSource = (s: KnowledgeSources) => s.code || s.docs || s.database;

function summary(sources: KnowledgeSources, databaseCount: number): string {
  const parts = SELECTABLE.filter((kind) => sources[kind]).map((kind) =>
    kind === KnowledgeSourceKind.Database ? C.databaseCount(databaseCount) : C.sourceLabel[kind],
  );
  return C.sourcesSummary(parts, sources.web);
}

/**
 * What the researcher may draw on (18 §2.1): code, docs and databases, and the separate web switch. Once a
 * conversation started it is shown, locked.
 */
export function SourcesPicker({
  sources,
  databaseCount,
  onChange,
}: {
  sources: KnowledgeSources;
  databaseCount: number;
  /** Absent: the conversation's sources, fixed (D73). */
  onChange?: (sources: KnowledgeSources) => void;
}) {
  const [open, setOpen] = useState(false);
  if (onChange === undefined) {
    return (
      <p className={styles.sourcesLine} title={C.projectLocked}>
        <Icon name="lock" size="sm" />
        {summary(sources, databaseCount)}
      </p>
    );
  }
  return (
    <div className={styles.sources}>
      <button type="button" className={styles.sourcesToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="book" size="sm" />
        {summary(sources, databaseCount)}
      </button>
      {open && (
        <fieldset className={styles.sourcesBox}>
          <legend className="label">{C.sources}</legend>
          {SELECTABLE.map((kind) => {
            const unavailable = kind === KnowledgeSourceKind.Database && databaseCount === 0;
            return (
              <label key={kind} className="check">
                <input
                  type="checkbox"
                  checked={sources[kind]}
                  disabled={unavailable}
                  onChange={(e) => onChange({ ...sources, [kind]: e.target.checked })}
                />
                <span className="col">
                  <span>
                    {kind === KnowledgeSourceKind.Database ? C.databaseCount(databaseCount) : C.sourceLabel[kind]}
                  </span>
                  {unavailable && <span className="hint">{C.noDatabase}</span>}
                </span>
              </label>
            );
          })}
          <div className={styles.webRow}>
            <div className="col grow">
              <span className="label" id="knowledge-web-label">
                {C.sourceLabel.web}
              </span>
              <span className="hint">{C.webHint}</span>
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={sources.web}
              aria-labelledby="knowledge-web-label"
              onClick={() => onChange({ ...sources, web: !sources.web })}
            />
          </div>
          {!hasSource(sources) && <p className="error-text">{C.needSource}</p>}
        </fieldset>
      )}
    </div>
  );
}
