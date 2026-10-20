import { useEffect, useRef, useState } from 'react';
import { type LayoutInput, layoutGraph } from './layout.ts';

type Positions = Map<string, { x: number; y: number }>;

/**
 * elkjs positions for the graph (14 §5). Only its shape — node ids and edges, not node contents — triggers a new
 * layout; a result for an outdated shape is dropped.
 */
export function useGraphLayout(graph: LayoutInput): Positions {
  const [positions, setPositions] = useState<Positions>(new Map());
  const latestShape = useRef('');
  const current = useRef(graph);
  current.current = graph;
  const shape = JSON.stringify([graph.nodes.map((n) => n.id), graph.edges.map((e) => [e.source, e.target])]);
  useEffect(() => {
    if (shape === latestShape.current) return;
    latestShape.current = shape;
    void layoutGraph(current.current).then((layout) => {
      if (latestShape.current === shape) setPositions(layout);
    });
  }, [shape]);
  return positions;
}
