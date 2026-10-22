import '@xyflow/react/dist/base.css';
import { NodeStatus } from '@aw/shared';
import {
  type Edge,
  MiniMap,
  type Node,
  type NodeHandle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS_COPY as C } from '../copy/plan-editor.ts';
import { NODE_STATUS_LABEL } from '../copy/tasks.ts';
import styles from './canvas.module.css';
import { CanvasControls } from './canvas-controls.tsx';
import { type CanvasEdit, CanvasEditContext, type CanvasEditState } from './canvas-edit.ts';
import { classNames, motionMs } from './canvas-util.ts';
import { type Box, END, END_HEIGHT, END_WIDTH, layoutGraph, NODE_HEIGHT, NODE_WIDTH, START } from './layout.ts';
import { StepEdge } from './step-edge.tsx';
import { type CanvasStep, PillNode, PlaceholderNode, TaskNode } from './task-node.tsx';
import { boundsOf, COMPACT_BELOW, fitViewport, panExtent, revealViewport, ZOOM } from './viewport.ts';

const NODE_TYPES = { task: TaskNode, pill: PillNode, placeholder: PlaceholderNode };
const EDGE_TYPES = { step: StepEdge };
/** The minimap starts open only for larger graphs (14 §5). */
const MINIMAP_FROM = 12;
const PAN_STEP = 80;
const FINISHED: readonly NodeStatus[] = [NodeStatus.Done, NodeStatus.Skipped];
const ACTIVE: readonly NodeStatus[] = [
  NodeStatus.Running,
  NodeStatus.WaitingInput,
  NodeStatus.Verifying,
  NodeStatus.AwaitingAcceptance,
];

/** An AI workflow's shape (26 §6.3): a dashed card standing for the planner's steps, never selected. */
export type CanvasPlaceholder = { id: string; title: string; description: string; dependsOn: readonly string[] };

type LaidOut = { id: string; dependsOn: readonly string[]; step: CanvasStep | CanvasPlaceholder };

export type FlowCanvasProps = {
  steps: readonly CanvasStep[];
  /** The canvas region's accessible name. */
  label: string;
  placeholder?: CanvasPlaceholder | undefined;
  selectedId?: string | undefined;
  onSelect?: ((id: string | undefined) => void) | undefined;
  /** Double-click or Enter on a step. */
  onOpen?: ((id: string) => void) | undefined;
  /** The task has finished: the end pill shows it. */
  finished?: boolean | undefined;
  /** Editable canvas: + on edges and steps, − on steps (26 §5). */
  edit?: CanvasEdit | undefined;
  /** A step just added: panned into view once if it is outside, then `onRevealed` clears the request. */
  revealId?: string | undefined;
  onRevealed?: (() => void) | undefined;
  testId?: string;
};

const handlesOf = (width: number, height: number): NodeHandle[] => [
  { type: 'target', position: Position.Left, x: 0, y: height / 2 - 0.5, width: 1, height: 1 },
  { type: 'source', position: Position.Right, x: width - 1, y: height / 2 - 0.5, width: 1, height: 1 },
];

/** How an edge is drawn (26 §7): plan lines, pending, finished, flowing into an active step, into a failed one. */
function edgeTone(source: NodeStatus | undefined, target: NodeStatus | undefined, isEnd: boolean, plan: boolean) {
  if (plan) return styles.edgePlan;
  const sourceDone = source === undefined || FINISHED.includes(source);
  if (!sourceDone) return styles.edgePending;
  if (isEnd) return styles.edgeDone;
  if (target === NodeStatus.Failed) return styles.edgeFailed;
  if (target !== undefined && ACTIVE.includes(target)) return styles.edgeLive;
  return target === undefined || target === NodeStatus.Pending || target === NodeStatus.Ready
    ? styles.edgePending
    : styles.edgeDone;
}

function Flow(props: FlowCanvasProps) {
  const {
    steps,
    label,
    placeholder,
    selectedId,
    onSelect,
    onOpen,
    finished = false,
    edit,
    revealId,
    onRevealed,
    testId,
  } = props;
  const { setViewport, getViewport, zoomIn, zoomOut } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const zoom = useStore((s) => s.transform[2]);
  const [menuFor, setMenuFor] = useState<string | undefined>();
  const [minimap, setMinimap] = useState(steps.length > MINIMAP_FROM);

  const layout = useMemo(() => {
    const idOf = new Map(steps.map((s) => [s.key, s.id]));
    // Shape steps after the placeholder depend on it by its id.
    if (placeholder !== undefined) idOf.set(placeholder.id, placeholder.id);
    const ids = (keys: readonly string[]) => keys.flatMap((k) => idOf.get(k) ?? []);
    return layoutGraph<LaidOut>([
      ...steps.map((step) => ({ id: step.id, dependsOn: ids(step.dependsOn), step })),
      ...(placeholder === undefined
        ? []
        : [{ id: placeholder.id, dependsOn: ids(placeholder.dependsOn), step: placeholder }]),
    ]);
  }, [steps, placeholder]);
  const bounds = useMemo(() => boundsOf([layout.start, layout.end, ...layout.placed.map((p) => p.box)]), [layout]);

  // Fit once the canvas has a size; refit on resize until the user moves the view (26 §2.2).
  const moved = useRef(false);
  const latest = useRef({ bounds, width, height });
  latest.current = { bounds, width, height };
  const fit = (duration: number) => {
    moved.current = false;
    const { bounds: b, width: w, height: h } = latest.current;
    void setViewport(fitViewport(b, w, h), { duration });
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (width > 0 && height > 0 && !moved.current) fitRef.current(0);
  }, [width, height]);

  // A reveal request is used once: later renders (typing in the step's form) keep the user's view.
  const revealed = useRef(onRevealed);
  revealed.current = onRevealed;
  useEffect(() => {
    if (revealId === undefined) return;
    const box = layout.placed.find((p) => p.step.id === revealId)?.box;
    if (box !== undefined) {
      const next = revealViewport(box, getViewport(), latest.current.width, latest.current.height);
      if (next !== null) void setViewport(next, { duration: motionMs(300) });
    }
    revealed.current?.();
  }, [revealId, layout, getViewport, setViewport]);

  const statusOf = useMemo(() => new Map(steps.map((s) => [s.id, s.status])), [steps]);
  const plan = steps.every((s) => s.status === undefined);
  const size = { width: NODE_WIDTH, height: NODE_HEIGHT, handles: handlesOf(NODE_WIDTH, NODE_HEIGHT) };
  const pill = (id: string, box: Box): Node => ({
    id,
    type: 'pill',
    position: { x: box.x, y: box.y },
    data: { label: id === START ? C.start : C.end, done: id === END && finished },
    focusable: false,
    width: END_WIDTH,
    height: END_HEIGHT,
    handles: handlesOf(END_WIDTH, END_HEIGHT),
  });
  const nodes: Node[] = [
    ...layout.placed.map(({ step: { id, step }, box }): Node => {
      const position = { x: box.x, y: box.y };
      if (!('key' in step)) {
        const data = { title: step.title, description: step.description };
        return { id, type: 'placeholder', position, data, focusable: false, ...size };
      }
      const ariaLabel = step.status === undefined ? step.title : `${step.title}，${NODE_STATUS_LABEL[step.status]}`;
      return { id, type: 'task', position, data: { step, selected: id === selectedId }, ariaLabel, ...size };
    }),
    pill(START, layout.start),
    pill(END, layout.end),
  ];
  const edges: Edge[] = layout.edges.map(({ source, target }) => ({
    id: `${source}->${target}`,
    source,
    target,
    type: 'step',
    className: classNames(edgeTone(statusOf.get(source), statusOf.get(target), target === END, plan)),
    focusable: false,
  }));

  const titleOf = (id: string) =>
    id === START ? C.start : id === END ? C.end : (layout.placed.find((p) => p.step.id === id)?.step.step.title ?? id);
  const editState: CanvasEditState | undefined =
    edit === undefined
      ? undefined
      : {
          edit: {
            ...edit,
            // Every edit closes the + menu.
            insert: (a, b) => {
              setMenuFor(undefined);
              edit.insert(a, b);
            },
            addAfter: (id) => {
              setMenuFor(undefined);
              edit.addAfter(id);
            },
            addParallel: (id) => {
              setMenuFor(undefined);
              edit.addParallel(id);
            },
          },
          titleOf,
          menuFor,
          setMenuFor,
        };

  const isStep = (id: string | undefined): id is string => id !== undefined && statusOf.has(id);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!(e.target instanceof HTMLElement)) return;
    if (e.key === 'Escape') {
      setMenuFor(undefined);
      onSelect?.(undefined);
      return;
    }
    if (e.target.closest('input, textarea, select, button') !== null) return;
    const focused = e.target.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    const duration = motionMs(200);
    const view = getViewport();
    switch (e.key) {
      case '+':
      case '=':
        void zoomIn({ duration });
        break;
      case '-':
        void zoomOut({ duration });
        break;
      case '0':
        fit(motionMs(300));
        break;
      case 'Enter':
        if (!isStep(focused)) return;
        if (onOpen === undefined) onSelect?.(focused);
        else onOpen(focused);
        break;
      case ' ':
        if (!isStep(focused)) return;
        onSelect?.(focused);
        break;
      case 'Delete':
      case 'Backspace':
        if (edit === undefined || selectedId === undefined || !edit.canRemove(selectedId)) return;
        edit.remove(selectedId);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        // Only the canvas itself pans; a focused step keeps React Flow's own handling.
        if (e.target !== e.currentTarget) return;
        const dx = e.key === 'ArrowLeft' ? PAN_STEP : e.key === 'ArrowRight' ? -PAN_STEP : 0;
        const dy = e.key === 'ArrowUp' ? PAN_STEP : e.key === 'ArrowDown' ? -PAN_STEP : 0;
        moved.current = true;
        void setViewport({ ...view, x: view.x + dx, y: view.y + dy }, { duration });
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  const className = classNames(styles.canvas, zoom < COMPACT_BELOW && styles.compact);
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas region takes focus for its keyboard shortcuts (26 §2.5)
    <section className={className} aria-label={label} tabIndex={0} onKeyDown={onKeyDown} data-testid={testId}>
      <CanvasEditContext.Provider value={editState}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={(_e, node) => {
            setMenuFor(undefined);
            if (isStep(node.id)) onSelect?.(node.id);
          }}
          onNodeDoubleClick={(_e, node) => {
            if (isStep(node.id)) onOpen?.(node.id);
          }}
          onPaneClick={() => {
            setMenuFor(undefined);
            onSelect?.(undefined);
          }}
          onMoveStart={(event) => {
            // Programmatic moves (fit, reveal) have no event.
            if (event !== null) moved.current = true;
          }}
          // Double-click opens a step (14 §5), it does not zoom; scrolling pans, ⌘ / Ctrl + scroll and pinch zoom.
          zoomOnDoubleClick={false}
          panOnScroll
          deleteKeyCode={null}
          translateExtent={panExtent(bounds, width, height, zoom)}
          minZoom={ZOOM.min}
          maxZoom={ZOOM.max}
          proOptions={{ hideAttribution: true }}
        >
          <CanvasControls onFit={() => fit(motionMs(300))} minimap={minimap} onMinimapChange={setMinimap} />
          {minimap && <MiniMap pannable zoomable />}
        </ReactFlow>
      </CanvasEditContext.Provider>
    </section>
  );
}

/**
 * The canvas every page uses (26 §1): React Flow with the layered layout, the control bar, pan limits, keyboard
 * access and, when `edit` is given, + / − editing.
 */
export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
