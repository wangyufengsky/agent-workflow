import type { DesignDiagramDTO, DesignDiagramNode, DesignDTO } from '@aw/shared';
import { useState } from 'react';
import { DESIGN_WORKBENCH_COPY as C } from '../../copy/design-workbench.ts';
import { type CompositionItem, DesignComposition } from './design-composition.tsx';
import type { ContentContext } from './design-content.tsx';
import { DesignDiagram } from './design-diagram.tsx';
import { graphNodeTarget, type ReadingTarget } from './design-reading.ts';
import styles from './design-workbench.module.css';

type Props = {
  title: string;
  design: DesignDTO;
  parent: CompositionItem;
  items: CompositionItem[];
  dependencies: DesignDiagramDTO[];
  source: ContentContext['source'];
  onNavigate: (target: ReadingTarget) => void;
};

export function dependenciesFor(design: DesignDTO, includes: (target: ReadingTarget) => boolean): DesignDiagramDTO[] {
  return design.diagrams.flatMap((diagram) => {
    const relevant = new Set(
      diagram.nodes.flatMap((node: DesignDiagramNode) => {
        const target = graphNodeTarget(design, diagram.sectionId, node);
        return target !== undefined && includes(target) ? [node.id] : [];
      }),
    );
    const edges = diagram.edges.filter(({ from, to }) => relevant.has(from) || relevant.has(to));
    const endpoints = new Set(edges.flatMap(({ from, to }) => [from, to]));
    return edges.length > 0 ? [{ ...diagram, edges, nodes: diagram.nodes.filter(({ id }) => endpoints.has(id)) }] : [];
  });
}

export function DesignArchitecture({ title, design, parent, items, dependencies, source, onNavigate }: Props) {
  const [dependency, setDependency] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const graph = dependencies.find(({ id }) => id === selectedId) ?? dependencies[0];
  const showDependency = dependency && graph !== undefined;
  return (
    <section className={styles.exploreSection}>
      <h3>{title}</h3>
      {graph !== undefined && (
        <fieldset className={styles.architectureMode} aria-label={title}>
          <button type="button" aria-pressed={!showDependency} onClick={() => setDependency(false)}>
            {C.composition}
          </button>
          <button type="button" aria-pressed={showDependency} onClick={() => setDependency(true)}>
            {C.dependency}
          </button>
        </fieldset>
      )}
      {showDependency && graph !== undefined ? (
        <div className={styles.dependencyPanel}>
          {dependencies.length > 1 && (
            <label className="row wrap">
              {C.relatedDiagrams}
              <select
                className="select"
                value={graph.id}
                onChange={(event) => setSelectedId(event.currentTarget.value)}
              >
                {dependencies.map(({ id, title }) => (
                  <option value={id} key={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <DesignDiagram
            key={graph.id}
            diagram={graph}
            onNavigate={onNavigate}
            source={source}
            targetOf={(node) => graphNodeTarget(design, graph.sectionId, node)}
          />
        </div>
      ) : (
        <DesignComposition title={title} parent={parent} items={items} onNavigate={onNavigate} />
      )}
    </section>
  );
}
