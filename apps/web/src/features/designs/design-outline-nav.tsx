import { type DesignDTO, DesignReviewState, type DesignRunDTO, type DesignSectionDTO } from '@aw/shared';
import { useMemo, useRef, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Icon } from '../../components/icon.tsx';
import { DESIGN_WORKBENCH_COPY as C, DESIGN_REVIEW_LABEL } from '../../copy/design-workbench.ts';
import { fileTarget, matchingReadingItems, type ReadingTarget, readingIndex, targetKey } from './design-reading.ts';
import styles from './design-workbench.module.css';

const MIN_NAV = 180;
const MAX_NAV = 380;
const NAV_STEP = 16;
export const DEFAULT_NAV = 232;

function sectionStatus(section: DesignSectionDTO, workingId: string | undefined, failedIds: ReadonlySet<string>) {
  if (section.id === workingId) return { label: C.working, tone: 'working' };
  if (failedIds.has(section.id)) return { label: C.failed, tone: 'failed' };
  if (section.reviewState === DesignReviewState.NeedsAttention)
    return { label: DESIGN_REVIEW_LABEL[section.reviewState], tone: 'attention' };
  return section.blocks === null ? { label: C.waiting, tone: 'waiting' } : { label: C.completed, tone: 'done' };
}

type NavProps = {
  design: DesignDTO;
  hidden: boolean;
  target: ReadingTarget;
  active: DesignRunDTO | undefined;
  failedIds: ReadonlySet<string>;
  onNavigate: (target: ReadingTarget, fromSearch?: boolean) => void;
  onCollapse: () => void;
};

function readableSection(design: DesignDTO, id: string) {
  return {
    graphs: design.diagrams.filter(({ sectionId }) => sectionId === id),
    files: design.files.filter(({ sectionId, responsibility }) => sectionId === id && responsibility !== null),
  };
}

export function DesignOutlineNav({ design, hidden, target, active, failedIds, onNavigate, onCollapse }: NavProps) {
  const [search, setSearch] = useState('');
  const items = useMemo(() => readingIndex(design), [design]);
  const matches = matchingReadingItems(items, search);
  const current = targetKey(target);
  const workingId = active?.targetSectionIds.find((id) => !active.doneSectionIds.includes(id));
  const go = (next: ReadingTarget) => () => onNavigate(next);

  return (
    <aside className={styles.navigator} aria-label={C.outline} hidden={hidden}>
      <div className={styles.paneTitle}>
        <strong>{C.outline}</strong>
        <Button size="sm" variant="ghost" icon="chevLeft" aria-label={C.hideNav} onClick={onCollapse} />
      </div>
      <div className={styles.searchRow}>
        <Icon name="search" size="sm" />
        <input
          className="input"
          type="search"
          aria-label={C.search}
          placeholder={C.search}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </div>
      {search.trim() !== '' ? (
        <div className={styles.results}>
          <p role="status" className="hint">
            {matches.length === 0 ? C.emptySearch : C.resultCount(matches.length)}
          </p>
          <ul>
            {matches.map((item) => (
              <li key={targetKey(item.target)}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.target, true)}
                  aria-current={targetKey(item.target) === current ? 'page' : undefined}
                >
                  <span>{item.label}</span>
                  {item.caption !== '' && <small>{item.caption}</small>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <nav className={styles.tree} aria-label={C.outline}>
          {design.sections
            .filter(({ selected }) => selected)
            .map((section) => {
              const { graphs, files } = readableSection(design, section.id);
              const status = sectionStatus(section, workingId, failedIds);
              const sectionTarget = { kind: 'section', sectionId: section.id } as const;
              return (
                <div key={section.id} className={styles.treeSection}>
                  <button
                    type="button"
                    className={styles.chapter}
                    aria-label={section.title}
                    aria-description={status.label}
                    aria-current={current === targetKey(sectionTarget) ? 'page' : undefined}
                    onClick={go(sectionTarget)}
                  >
                    <span
                      className={styles.chapterDot}
                      data-tone={status.tone}
                      role="img"
                      aria-label={status.label}
                      title={status.label}
                    />
                    <span>{section.title}</span>
                  </button>
                  {(graphs.length > 0 || files.length > 0) && (
                    <details className={styles.treeGroup}>
                      <summary>
                        {C.relatedFiles} · {graphs.length + files.length}
                      </summary>
                      <ul>
                        {graphs.map((graph) => {
                          const next = { kind: 'diagram', sectionId: section.id, diagramId: graph.id } as const;
                          return (
                            <li key={graph.id}>
                              <button
                                type="button"
                                aria-current={targetKey(next) === current ? 'page' : undefined}
                                onClick={go(next)}
                              >
                                <Icon name="flow" size="sm" />
                                {graph.title}
                              </button>
                            </li>
                          );
                        })}
                        {files.map((file) => {
                          const next = fileTarget(file, section.id);
                          return (
                            <li key={file.id}>
                              <button
                                type="button"
                                aria-current={targetKey(next) === current ? 'page' : undefined}
                                onClick={go(next)}
                              >
                                <Icon name="file" size="sm" />
                                <span>{file.relPath}</span>
                              </button>
                              {file.symbols.length > 0 && (
                                <details className={styles.treeGroup}>
                                  <summary>
                                    {C.symbol} · {file.symbols.length}
                                  </summary>
                                  <ul>
                                    {file.symbols.map((symbol) => {
                                      const symbolTarget = fileTarget(file, section.id, symbol.id);
                                      return (
                                        <li key={symbol.id}>
                                          <button
                                            type="button"
                                            className="mono"
                                            aria-current={targetKey(symbolTarget) === current ? 'page' : undefined}
                                            onClick={go(symbolTarget)}
                                          >
                                            {symbol.name}
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </details>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
        </nav>
      )}
    </aside>
  );
}

export function OutlineResizer({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const pointer = useRef<{ x: number; width: number } | null>(null);
  const size = (next: number) => onWidth(Math.max(MIN_NAV, Math.min(MAX_NAV, next)));
  return (
    <hr
      tabIndex={0}
      className={styles.resizer}
      aria-label={C.resizeNav}
      aria-orientation="vertical"
      aria-valuemin={MIN_NAV}
      aria-valuemax={MAX_NAV}
      aria-valuenow={width}
      onPointerDown={(event) => {
        pointer.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (pointer.current !== null) size(pointer.current.width + event.clientX - pointer.current.x);
      }}
      onLostPointerCapture={() => {
        pointer.current = null;
      }}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowLeft' ? width - NAV_STEP : event.key === 'ArrowRight' ? width + NAV_STEP : undefined;
        if (next !== undefined) {
          event.preventDefault();
          size(next);
        }
      }}
    />
  );
}
