import type { Dimensions, NodeChange } from '@xyflow/react';
import { useCallback, useState } from 'react';

/**
 * The sizes React Flow measured, to carry into the node objects a canvas makes on each update. React Flow drops the
 * size of a node object it has not seen and measures again only when its own state changes from measured to not; when
 * a measurement and new node objects land in the same render it never does, and the node stays hidden for good (CI
 * trace: after a pause no step could be clicked). Pass `onNodesChange` to ReactFlow and spread `measured(id)` into
 * each node.
 */
export function useNodeSizes() {
  const [sizes, setSizes] = useState<ReadonlyMap<string, Dimensions>>(new Map());
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const reported = changes.flatMap((c) =>
      c.type === 'dimensions' && c.dimensions ? [[c.id, c.dimensions] as const] : [],
    );
    if (reported.length > 0) setSizes((prev) => new Map([...prev, ...reported]));
  }, []);
  const measured = useCallback(
    (id: string): { measured?: Dimensions } => {
      const size = sizes.get(id);
      return size === undefined ? {} : { measured: size };
    },
    [sizes],
  );
  return { onNodesChange, measured };
}
