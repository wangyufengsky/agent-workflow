import { NodeKind, type PlanGraph, type WorkflowDefinition } from '@aw/shared';

/** Remove runtime-only steps while preserving dependencies between the reusable business steps. */
export function workflowDefinitionFromPlan(graph: PlanGraph, original: WorkflowDefinition): WorkflowDefinition {
  const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const nodes = graph.nodes.filter((node) => node.kind === undefined || node.kind === NodeKind.Normal);
  const keys = new Set(nodes.map((node) => node.key));
  const businessDependencies = (dependencies: string[], visited: Set<string>): string[] =>
    dependencies.flatMap((key) => {
      if (visited.has(key)) return [];
      visited.add(key);
      if (keys.has(key)) return [key];
      const node = byKey.get(key);
      return node === undefined ? [key] : businessDependencies(node.dependsOn, visited);
    });
  return {
    allowedRoles: [...new Set(nodes.map((node) => node.roleKey))],
    checkpoints: original.checkpoints,
    defaultAcceptance: original.defaultAcceptance,
    template: { nodes: nodes.map((node) => ({ ...node, dependsOn: businessDependencies(node.dependsOn, new Set()) })) },
  };
}
