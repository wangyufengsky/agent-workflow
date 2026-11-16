import { FRONTEND_VERIFY_PREFIX, NodeKind, NodeStatus } from '@aw/shared';
import type { Node } from '../nodes/index.ts';

export function frontendVerified(nodes: readonly Pick<Node, 'key' | 'kind' | 'status'>[]): boolean {
  const last = nodes.findLast((node) => node.kind !== NodeKind.Verify);
  return last?.status === NodeStatus.Done && last.key.startsWith(FRONTEND_VERIFY_PREFIX);
}
