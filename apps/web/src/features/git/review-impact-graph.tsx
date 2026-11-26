import { DesignEvidenceClass, type GitImpactItemDTO, layoutDesignDiagram } from '@aw/shared';
import { useId } from 'react';
import { GIT_REVIEW_COPY as C } from '../../copy/git-review.ts';
import styles from './review-result.module.css';

type Props = {
  impacts: readonly GitImpactItemDTO[];
  activeId: string | undefined;
  onImpact: (id: string) => void;
};

const fileKey = (path: string) => `file:${path}`;
const impactKey = (id: string) => `impact:${id}`;

function impactGraph(impacts: readonly GitImpactItemDTO[]) {
  const labels = new Map(
    impacts.map((impact) => [
      impactKey(impact.id),
      {
        title: impact.title,
        detail: C.classification[impact.classification],
        impactId: impact.id,
      },
    ]),
  );
  const edges = impacts.flatMap((impact) => {
    const to = impactKey(impact.id);
    const sources = [
      ...new Set(
        (impact.sourcePaths ?? []).map((path) => {
          const key = fileKey(path);
          labels.set(key, { title: path, detail: C.changedFile, impactId: '' });
          return key;
        }),
      ),
      ...new Set((impact.viaImpactIds ?? []).map(impactKey).filter((key) => labels.has(key) && key !== to)),
    ];
    return sources.map((from) => ({
      id: JSON.stringify([from, to]),
      from,
      to,
      evidence: impact.evidenceClass,
    }));
  });
  const connected = new Set(edges.flatMap(({ from, to }) => [from, to]));
  const nodes = [...labels.keys()].filter((id) => connected.has(id)).map((id) => ({ id }));
  return { labels, edges, layout: layoutDesignDiagram(nodes, edges, 'adaptive') };
}

export function ReviewImpactGraph({ impacts, activeId, onImpact }: Props) {
  const marker = useId();
  const { labels, edges, layout } = impactGraph(impacts);
  if (edges.length === 0) {
    return (
      <>
        <div className={styles.propagationGrid}>
          {Object.entries(C.classification).map(([kind, label]) => {
            const items = impacts.filter(({ classification }) => kind === classification);
            if (items.length === 0) return null;
            return (
              <div className={styles.propagationLane} key={kind}>
                <span className={styles.impactBadge} data-classification={kind}>
                  {label}
                </span>
                {items.map((impact) => (
                  <button
                    type="button"
                    key={impact.id}
                    aria-pressed={activeId === impact.id}
                    onClick={() => onImpact(impact.id)}
                  >
                    {impact.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <p className="hint">{C.noEdges}</p>
      </>
    );
  }

  const titleOf = (id: string) => labels.get(id)?.title ?? id;
  return (
    <>
      <fieldset className={styles.graphLegend} aria-label={C.edgeLegend}>
        {Object.values(DesignEvidenceClass).map((evidence) => (
          <span key={evidence} data-evidence={evidence}>
            {C.evidence[evidence]}
          </span>
        ))}
      </fieldset>
      <section className={styles.graphViewport} aria-label={C.propagation}>
        <div className={styles.graphSurface} style={{ width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} className={styles.graphEdges} aria-hidden="true">
            <defs>
              <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {layout.routes.map((route) => {
              const edge = edges.find(({ id }) => id === route.id);
              return (
                edge !== undefined && (
                  <path
                    key={route.id}
                    d={route.path}
                    fill="none"
                    markerEnd={`url(#${marker})`}
                    data-evidence={edge.evidence}
                  >
                    <title>{C.edge(titleOf(edge.from), titleOf(edge.to), C.evidence[edge.evidence])}</title>
                  </path>
                )
              );
            })}
          </svg>
          {layout.placed.map(({ id, box }) => {
            const data = labels.get(id);
            if (data === undefined) return null;
            const { title, detail, impactId } = data;
            const style = { left: box.x, top: box.y, width: box.width, height: box.height };
            const content = (
              <>
                <small>{detail}</small>
                <strong>{title}</strong>
              </>
            );
            return impactId === '' ? (
              <div key={id} className={styles.graphNode} style={style} title={title}>
                {content}
              </div>
            ) : (
              <button
                key={id}
                type="button"
                className={styles.graphNode}
                style={style}
                title={title}
                aria-pressed={activeId === impactId}
                onClick={() => onImpact(impactId)}
              >
                {content}
              </button>
            );
          })}
        </div>
      </section>
      <details className={styles.graphRelationships}>
        <summary>{C.relationships}</summary>
        <ul>
          {edges.map((edge) => (
            <li key={edge.id}>{C.edge(titleOf(edge.from), titleOf(edge.to), C.evidence[edge.evidence])}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
