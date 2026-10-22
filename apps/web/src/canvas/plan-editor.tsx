import {
  lockedChanges,
  type NodeStatus,
  type PlanGraph,
  PlanProblemCode,
  type PlanRules,
  type RoleDTO,
  validatePlanGraph,
} from '@aw/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from '../components/button.tsx';
import { Panel } from '../components/panel.tsx';
import { Tabs } from '../components/tabs.tsx';
import { PLAN_EDITOR_COPY as C } from '../copy/plan-editor.ts';
import type { CanvasEdit } from './canvas-edit.ts';
import { FlowCanvas } from './flow-canvas.tsx';
import { START } from './layout.ts';
import type { EditorProblem, PlanLock } from './plan-check.ts';
import editorStyles from './plan-editor.module.css';
import {
  type Added,
  addAfter,
  addAtEnd,
  addParallel,
  insertBetween,
  type NewStep,
  removeAndReconnect,
  renameNode,
  updateNode,
} from './plan-graph-edit.ts';
import { PlanNodeForm } from './plan-node-form.tsx';
import type { CanvasStep } from './task-node.tsx';
import type { History } from './use-history.ts';

type Props = {
  /** The canvas region's accessible name. */
  label: string;
  /** The graph and its undo history; the caller owns both. */
  history: Pick<History<PlanGraph>, 'value' | 'undo' | 'canUndo'> & {
    change: (graph: PlanGraph, mergeKey?: string) => void;
  };
  /** `planEditRules` for a task's plan; the workflow's roles for a fixed workflow's template. */
  rules: PlanRules;
  roles: readonly RoleDTO[];
  /** Adjusting a paused task: started steps cannot change (09 §2). */
  lock?: PlanLock | undefined;
  /** States of a running task's steps, shown on the canvas. */
  statuses?: ReadonlyMap<string, NodeStatus> | undefined;
  /** `checkPlan` of the graph; the caller also uses it to allow saving. */
  problems: readonly EditorProblem[];
  /** The toolbar above the canvas; `addStep` is the editor's 添加步骤 (26 §5.1). */
  toolbar: (addStep: () => void) => ReactNode;
  /** Save / confirm / cancel buttons of the caller, under the problems. */
  actions?: ReactNode;
  /** The workflow editor's 流程设置 (26 §6.3): the side panel gets a tab for it. */
  settings?: ReactNode;
};

const Tab = { Step: 'step', Settings: 'settings' } as const;

const orderProblems = (graph: PlanGraph, rules: PlanRules) =>
  validatePlanGraph(graph, rules).filter((p) => p.code === PlanProblemCode.RequiredStepOrder).length;

/**
 * Plan editor (26 §5, 14 §5): + on edges and steps adds steps already connected, − removes one and joins its
 * neighbours, the side panel edits the selected step; the problems are the backend's (same `validatePlanGraph`).
 */
export function PlanEditor({
  label,
  history,
  rules,
  roles,
  lock,
  statuses,
  problems,
  toolbar,
  actions,
  settings,
}: Props) {
  const graph = history.value;
  const [selected, setSelectedKey] = useState<string | undefined>(graph.nodes[0]?.key);
  const [tab, setTab] = useState<string>(Tab.Step);
  const setSelected = (key: string | undefined) => {
    setSelectedKey(key);
    if (key !== undefined) setTab(Tab.Step);
  };
  const [reveal, setReveal] = useState<string | undefined>();
  const [removed, setRemoved] = useState<string | undefined>();
  const [focusTitle, setFocusTitle] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusTitle > 0) titleRef.current?.select();
  }, [focusTitle]);

  const locked = lock?.locked ?? new Set<string>();
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const change = (next: PlanGraph, mergeKey?: string) => {
    setRemoved(undefined);
    history.change(next, mergeKey);
  };

  // Only edits whose result adds no locked-step change and no required-step order problem are offered (26 §5.4).
  const lockedNow = lock === undefined ? 0 : lockedChanges(lock.base, graph, lock.locked).length;
  const orderNow = orderProblems(graph, rules);
  const allowed = (next: PlanGraph) =>
    (lock === undefined || lockedChanges(lock.base, next, lock.locked).length <= lockedNow) &&
    orderProblems(next, rules) <= orderNow;
  const newStep = (like: string | undefined): NewStep => {
    const roleKey = graph.nodes.find((n) => n.key === like)?.roleKey;
    return {
      title: C.newStepTitle,
      roleKey: roleKey !== undefined && rules.allowedRoles.includes(roleKey) ? roleKey : (rules.allowedRoles[0] ?? ''),
      instructions: '',
    };
  };
  const added = ({ graph: next, key }: Added) => {
    change(next);
    setSelected(key);
    setReveal(key);
    setFocusTitle((n) => n + 1);
  };
  const blank = newStep(undefined);
  const edit: CanvasEdit = {
    canInsert: (a, b) => allowed(insertBetween(graph, a, b, blank).graph),
    canAddAfter: (key) => allowed(addAfter(graph, key, blank).graph),
    canAddParallel: (key) => allowed(addParallel(graph, key, blank).graph),
    canRemove: (key) => allowed(removeAndReconnect(graph, key)),
    insert: (a, b) => added(insertBetween(graph, a, b, newStep(a === START ? b : a))),
    addAfter: (key) => added(addAfter(graph, key, newStep(key))),
    addParallel: (key) => added(addParallel(graph, key, newStep(key))),
    remove: (key) => {
      const title = graph.nodes.find((n) => n.key === key)?.title ?? key;
      change(removeAndReconnect(graph, key));
      setRemoved(title);
      if (selected === key) setSelected(undefined);
    },
  };
  const addStep = () =>
    selected !== undefined && edit.canAddAfter(selected)
      ? edit.addAfter(selected)
      : added(addAtEnd(graph, newStep(undefined)));

  const steps: CanvasStep[] = graph.nodes.map((n) => {
    const status = statuses?.get(n.key);
    return {
      id: n.key,
      key: n.key,
      title: n.title === '' ? n.key : n.title,
      role: roleName(n.roleKey),
      dependsOn: n.dependsOn,
      description: n.instructions.split('\n')[0] ?? '',
      locked: locked.has(n.key),
      ...(status === undefined ? {} : { status }),
    };
  });
  const node = graph.nodes.find((n) => n.key === selected);
  const stepPanels = (
    <>
      <Panel title={C.step}>
        {node === undefined ? (
          <p className="hint">{C.noSelection}</p>
        ) : (
          <PlanNodeForm
            graph={graph}
            node={node}
            allowedRoles={rules.allowedRoles}
            roles={roles}
            locked={locked.has(node.key)}
            titleRef={titleRef}
            onPatch={(patch) =>
              change(updateNode(graph, node.key, patch), `${node.key}:${Object.keys(patch).join(',')}`)
            }
            onRename={(key) => {
              change(renameNode(graph, node.key, key));
              setSelected(key);
            }}
            onRemove={edit.canRemove(node.key) ? () => edit.remove(node.key) : undefined}
          />
        )}
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
    </>
  );

  return (
    <div className={editorStyles.editor} data-testid="plan-editor">
      <div className={editorStyles.toolbar}>{toolbar(addStep)}</div>
      <div className={editorStyles.layout}>
        <div className={editorStyles.canvas}>
          <FlowCanvas
            steps={steps}
            label={label}
            selectedId={selected}
            onSelect={setSelected}
            onOpen={(key) => {
              setSelected(key);
              setFocusTitle((n) => n + 1);
            }}
            edit={edit}
            revealId={reveal}
          />
          {removed !== undefined && (
            <div className={editorStyles.notice} role="status">
              <span>{C.removed(removed)}</span>
              {history.canUndo && (
                <Button size="sm" onClick={history.undo}>
                  {C.undo}
                </Button>
              )}
            </div>
          )}
        </div>
        <aside className={editorStyles.side}>
          {settings === undefined ? (
            stepPanels
          ) : (
            <Tabs
              value={tab}
              onValueChange={setTab}
              items={[
                { value: Tab.Step, label: C.step, content: <div className="col">{stepPanels}</div> },
                { value: Tab.Settings, label: C.settings, content: settings },
              ]}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
