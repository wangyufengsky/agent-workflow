import ELK from 'elkjs/lib/elk.bundled.js';

/** Canvas node size (14 §5). */
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 72;

const elk = new ELK();

export type LayoutInput = {
  nodes: ReadonlyArray<{ id: string }>;
  edges: ReadonlyArray<{ id: string; source: string; target: string }>;
};

/** elkjs `layered`, left to right (14 §5); returns the top-left corner of every node. */
export async function layoutGraph({ nodes, edges }: LayoutInput): Promise<Map<string, { x: number; y: number }>> {
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  return new Map((result.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}
