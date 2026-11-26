import {
  DesignEvidenceClass,
  DesignKnowledgeMatch,
  DiffSide,
  ErrorCode,
  GitImpactClassification,
  type GitImpactItemDTO,
  type GitReviewDTO,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type RefObject, useLayoutEffect } from 'react';
import { ApiError } from '../../api/client.ts';
import { ROUTES } from '../../app/routes.ts';
import { Icon } from '../../components/icon.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { GIT_REVIEW_COPY as C } from '../../copy/git-review.ts';
import { resolveDesignImpactTarget } from '../designs/design-impact-target.ts';
import { designQuery } from '../designs/designs.queries.ts';
import type { EvidenceLocation } from './review-evidence-dialog.tsx';
import { ReviewImpactGraph } from './review-impact-graph.tsx';
import styles from './review-result.module.css';

type Props = {
  review: GitReviewDTO;
  activeId: string | undefined;
  activeRef: RefObject<HTMLElement | null>;
  onImpact: (id: string) => void;
  onEvidence: (location: EvidenceLocation) => void;
};

function evidenceLabel(path: string, line?: number, end?: number): string {
  return line === undefined ? path : `${path}:${line}${end === undefined || line === end ? '' : `–${end}`}`;
}

function ImpactDesign({ review, impact }: { review: GitReviewDTO; impact: GitImpactItemDTO }) {
  const { designId } = review;
  const { targetKind, targetId } = impact;
  const design = useQuery({ ...designQuery(designId ?? ''), enabled: designId !== null && targetId !== undefined });
  if (targetId === undefined || review.designMatch === DesignKnowledgeMatch.Missing) return null;
  const deleted =
    designId === null || (design.error instanceof ApiError && design.error.code === ErrorCode.DesignNotFound);
  const targetMissing =
    design.data !== undefined && resolveDesignImpactTarget(design.data, { targetKind, targetId }) === undefined;
  if (deleted || targetMissing) {
    return (
      <span className="row wrap">
        <button type="button" className={styles.impactLink} disabled>
          {C.openNode}
        </button>
        <span className="hint">{deleted ? C.designDeleted : C.targetMissing}</span>
      </span>
    );
  }
  return (
    <Link
      className={styles.impactLink}
      to={ROUTES.designWorkbench}
      params={{ designId }}
      search={{ targetKind, targetId }}
    >
      {C.openNode}
      <Icon name="chevron" size="sm" />
    </Link>
  );
}

function ImpactCard({
  impact,
  review,
  active,
  activeRef,
  onEvidence,
}: {
  impact: GitImpactItemDTO;
  review: GitReviewDTO;
  active: boolean;
  activeRef: Props['activeRef'];
  onEvidence: Props['onEvidence'];
}) {
  const { evidencePath, lineStart, lineEnd } = impact;
  useLayoutEffect(() => {
    if (!active) return;
    activeRef.current?.focus({ preventScroll: true });
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, activeRef]);
  return (
    <article
      className={`card ${styles.impactCard}`}
      data-active={active || undefined}
      tabIndex={-1}
      ref={active ? activeRef : undefined}
      aria-label={impact.title}
    >
      <header>
        <span className={styles.impactBadge} data-classification={impact.classification}>
          {C.classification[impact.classification]}
        </span>
        <span className={`badge ${impact.evidenceClass === DesignEvidenceClass.Static ? 'st-ok' : 'st-idle'}`}>
          {C.evidence[impact.evidenceClass]}
        </span>
        <span className="hint">{C.kind[impact.targetKind]}</span>
        <h4>{impact.title}</h4>
      </header>
      <div className={styles.reason}>
        <Markdown source={impact.reason} />
      </div>
      {impact.suggestedChecks.length > 0 && (
        <ul className={styles.suggestions} aria-label={C.regression}>
          {[...new Set(impact.suggestedChecks)].map((check) => (
            <li key={check}>
              <Markdown inline source={check} />
            </li>
          ))}
        </ul>
      )}
      {(evidencePath !== undefined || impact.targetId !== undefined) && (
        <footer>
          {evidencePath !== undefined && (
            <button
              type="button"
              className={styles.impactLink}
              onClick={() =>
                onEvidence({ path: evidencePath, line: lineStart, end: lineEnd, side: impact.side ?? DiffSide.New })
              }
            >
              <Icon name="file" size="sm" />
              <span>
                {C.source} · <code>{evidenceLabel(evidencePath, lineStart, lineEnd)}</code>
              </span>
            </button>
          )}
          <ImpactDesign review={review} impact={impact} />
        </footer>
      )}
    </article>
  );
}

export function ReviewImpacts({ review, activeId, activeRef, onImpact, onEvidence }: Props) {
  const groups = Object.values(GitImpactClassification)
    .map((kind) => ({ kind, items: review.impacts.filter(({ classification }) => classification === kind) }))
    .filter(({ items }) => items.length > 0);
  return (
    <div className={styles.stack}>
      {review.impactTruncated && (
        <div className="banner warn" role="status">
          <Icon name="alert" size="sm" />
          <strong>{C.truncated}</strong>
        </div>
      )}
      {review.designMatch !== DesignKnowledgeMatch.Missing && review.uncoveredPaths.length > 0 && (
        <details className={`card ${styles.coverage}`}>
          <summary>{C.coverage(review.uncoveredPaths.length)}</summary>
          <ul>
            {review.uncoveredPaths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {groups.length === 0 ? (
        <p className="hint">{C.noImpacts}</p>
      ) : (
        <>
          <details className={`card ${styles.propagation}`} open>
            <summary>
              <strong>{C.propagation}</strong>
            </summary>
            <ReviewImpactGraph impacts={review.impacts} activeId={activeId} onImpact={onImpact} />
          </details>
          {groups.map(({ kind, items }) => (
            <section className={styles.impactGroup} key={kind} aria-label={C.classification[kind]}>
              <h3>{C.tabCount(C.classification[kind], items.length)}</h3>
              {items.map((impact) => (
                <ImpactCard
                  key={impact.id}
                  impact={impact}
                  review={review}
                  active={impact.id === activeId}
                  activeRef={activeRef}
                  onEvidence={onEvidence}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
