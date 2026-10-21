import '@xyflow/react/dist/base.css';
import { type NodeStatus, type PlanGraph, type PlanRules, type RoleDTO, transitiveDependencies } from '@aw/shared';
import {
  type Connection,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/button.tsx';
import { Panel } from '../components/panel.tsx';
import { PLAN_EDITOR_COPY as C } from '../copy/plan-editor.ts';
import styles from './canvas.module.css';
import { CANVAS_FIT, EDGE_PLAN } from './canvas-style.ts';
import type { EditorProblem, PlanLock } from './plan-check.ts';
import editorStyles from './plan-editor.module.css';
import { addNode, connect, disconnect, removeNode, renameNode, updateNode } from './plan-graph-edit.ts';
import { PlanNodeForm } from './plan-node-form.tsx';
import { TaskNode, type TaskNodeData } from './task-node.tsx';
import { useGraphLayout } from './use-graph-layout.ts';
import { useNodeSizes } from './use-node-sizes.ts';

const NODE_TYPES = { task: TaskNode };
const MINIMAP_FROM = 12;

type Props = {
  graph: PlanGraph;
  onChange: (graph: PlanGraph) => void;
  /** `planEditRules` for a task's plan; the workflow's roles for a fixed workflow's template. */
  rules: PlanRules;
  roles: readonly RoleDTO[];
  /** Adjusting a paused task: started steps cannot change (09 §2). */
  lock?: PlanLock | undefined;
  /** States of a running task's steps, shown on the canvas. */
  statuses?: ReadonlyMap<string, NodeStatus> | undefined;
  /** `checkPlan` of the graph; the caller also uses it to allow saving. */
  problems: readonly EditorProblem[];
  /** Save / confirm / cancel buttons of the caller. */
  actions?: ReactNode;
};

type FlowProps = Pick<Props, 'graph' | 'onChange' | 'roles' | 'statuses'> & {
  isLocked: (key: string) => boolean;
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
};

/** The editable canvas: drag from a step's right handle to another's left one to add a dependency. */
function EditorFlow({ graph, onChange, roles, statuses, isLocked, selected, onSelect }: FlowProps) {
  const { fitView } = useReactFlow();
  const keys = useMemo(() => new Set(graph.nodes.map((n) => n.key)), [graph]);
  const edges = useMemo<Edge[]>(
    () =>
      graph.nodes.flatMap((node) =>
        node.dependsOn
          .filter((key) => keys.has(key))
          .map((key) => ({
            id: `${key}->${node.key}`,
            source: key,
            target: node.key,
            // A started step keeps its dependencies.
            deletable: !isLocked(node.key),
            style: EDGE_PLAN,
          })),
      ),
    [graph, keys, isLocked],
  );
  const positions = useGraphLayout({ nodes: graph.nodes.map((n) => ({ id: n.key })), edges });
  const fitted = useRef(false);
  const measured = useStore((state) => state.width > 0 && state.height > 0);
  useEffect(() => {
    if (fitted.current || !measured || positions.size === 0) return;
    fitted.current = true;
    requestAnimationFrame(() => void fitView(CANVAS_FIT));
  }, [measured, positions, fitView]);

  const { onNodesChange, measured: sizeOf } = useNodeSizes();
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const nodes: Node<TaskNodeData>[] = graph.nodes.map((n) => {
    const status = statuses?.get(n.key);
    return {
      id: n.key,
      type: 'task',
      position: positions.get(n.key) ?? { x: 0, y: 0 },
      data: {
        step: {
          id: n.key,
          key: n.key,
          title: n.title === '' ? n.key : n.title,
          role: roleName(n.roleKey),
          dependsOn: n.dependsOn,
          ...(status === undefined ? {} : { status }),
        },
        selected: n.key === selected,
        connectable: true,
        locked: isLocked(n.key),
      },
      deletable: !isLocked(n.key),
      draggable: false,
      ...sizeOf(n.key),
    };
  });

  const isValidConnection = (c: Connection | Edge) =>
    c.source !== c.target &&
    !isLocked(c.target) &&
    !graph.nodes.some((n) => n.key === c.target && n.dependsOn.includes(c.source)) &&
    !transitiveDependencies(graph.nodes, c.source).has(c.target);

  return (
    <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChange}
      edges={edges}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      nodesConnectable
      elementsSelectable
      isValidConnection={isValidConnection}
      onConnect={(c) => onChange(connect(graph, c.source, c.target))}
      // One callback for both: deleting a step also deletes its edges.
      onDelete={({ nodes: removed, edges: cut }) => {
        const withoutNodes = removed.reduce((g, n) => removeNode(g, n.id), graph);
        onChange(cut.reduce((g, e) => disconnect(g, e.source, e.target), withoutNodes));
        if (removed.some((n) => n.id === selected)) onSelect(undefined);
      }}
      onNodeClick={(_e, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      zoomOnDoubleClick={false}
      deleteKeyCode={['Backspace', 'Delete']}
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={1.5}
    >
      {graph.nodes.length > MINIMAP_FROM && <MiniMap pannable zoomable />}
    </ReactFlow>
  );
}

/**
 * Plan editor (M5-01, 14 §5): add, connect and remove steps on the canvas, edit the selected step in the side panel,
 * and see the problems the backend would report (same `validatePlanGraph`). Controlled: the caller keeps the graph.
 */
export function PlanEditor({ graph, onChange, rules, roles, lock, statuses, problems, actions }: Props) {
  const [selected, setSelected] = useState<string | undefined>(graph.nodes[0]?.key);
  const isLocked = useMemo(() => {
    const locked = lock?.locked ?? new Set<string>();
    return (key: string) => locked.has(key);
  }, [lock]);
  const node = graph.nodes.find((n) => n.key === selected);
  const add = () => {
    const created = addNode(graph, {
      title: C.newStepTitle,
      roleKey: rules.allowedRoles[0] ?? '',
      instructions: '',
      dependsOn: [],
    });
    onChange(created.graph);
    setSelected(created.key);
  };

  return (
    <div className={editorStyles.layout} data-testid="plan-editor">
      <section className={styles.canvas} aria-label={C.canvasLabel}>
        <ReactFlowProvider>
          <EditorFlow
            graph={graph}
            onChange={onChange}
            roles={roles}
            statuses={statuses}
            isLocked={isLocked}
            selected={selected}
            onSelect={setSelected}
          />
        </ReactFlowProvider>
      </section>
      <aside className={editorStyles.side}>
        <Panel
          title={C.step}
          actions={
            <Button size="sm" icon="plus" onClick={add}>
              {C.addStep}
            </Button>
          }
        >
          <div className="col">
            <select
              className="select"
              aria-label={C.step}
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value === '' ? undefined : e.target.value)}
            >
              <option value="">—</option>
              {graph.nodes.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.title === '' ? n.key : `${n.title}（${n.key}）`}
                </option>
              ))}
            </select>
            {node === undefined ? (
              <p className="hint">{C.noSelection}</p>
            ) : (
              <PlanNodeForm
                graph={graph}
                node={node}
                allowedRoles={rules.allowedRoles}
                roles={roles}
                locked={isLocked(node.key)}
                onPatch={(patch) => onChange(updateNode(graph, node.key, patch))}
                onRename={(key) => {
                  onChange(renameNode(graph, node.key, key));
                  setSelected(key);
                }}
                onRemove={() => {
                  onChange(removeNode(graph, node.key));
                  setSelected(undefined);
                }}
              />
            )}
          </div>
        </Panel>
        <Panel title={C.problems}>
          <div className="col">
            {problems.length === 0 ? (
              <p className="hint">{C.noProblems}</p>
            ) : (
              <ul className={editorStyles.problems} data-testid="plan-problems">
                {problems.map((p) => (
                  <li key={`${p.key}-${p.message}`}>
                    {p.key === undefined ? (
                      p.message
                    ) : (
                      <button type="button" className={editorStyles.problemLink} onClick={() => setSelected(p.key)}>
                        {p.message}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {actions}
          </div>
        </Panel>
      </aside>
    </div>
  );
}
