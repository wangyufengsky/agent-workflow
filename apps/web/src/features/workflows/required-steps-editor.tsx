import type { RequiredStep, RoleDTO } from '@aw/shared';
import { type ReactNode, useState } from 'react';
import type { CanvasEdit } from '../../canvas/canvas-edit.ts';
import { FlowCanvas } from '../../canvas/flow-canvas.tsx';
import editorStyles from '../../canvas/plan-editor.module.css';
import type { CanvasStep } from '../../canvas/task-node.tsx';
import { Panel } from '../../components/panel.tsx';
import { Tabs } from '../../components/tabs.tsx';
import { CANVAS_COPY, PLAN_EDITOR_COPY } from '../../copy/plan-editor.ts';
import { WORKFLOW_EDITOR_COPY as C } from '../../copy/workflows.ts';
import { RequiredStepForm } from './required-step-form.tsx';
import { addRequired, insertPosition, insertRequired, PLANNED, shapeDependencies } from './required-steps.ts';

type Props = {
  steps: readonly RequiredStep[];
  onChange: (steps: RequiredStep[], mergeKey?: string) => void;
  /** A built-in workflow: the shape is shown, not edited. */
  readonly: boolean;
  allowedRoles: readonly string[];
  roles: readonly RoleDTO[];
  /** The page's toolbar; `addStep` adds a step the plans must contain anywhere. */
  toolbar: (addStep: () => void) => ReactNode;
  settings: ReactNode;
  /** Content of the problems panel. */
  problems: ReactNode;
};

const Tab = { Step: 'step', Settings: 'settings' } as const;

/**
 * An AI workflow's shape (26 §6.3): its `first` required steps, the planner's steps, its `last` required steps. The +
 * before or after the planner's steps adds a required step there; the side panel edits the selected one.
 */
export function RequiredStepsEditor({
  steps,
  onChange,
  readonly,
  allowedRoles,
  roles,
  toolbar,
  settings,
  problems,
}: Props) {
  const [selected, setSelected] = useState<string | undefined>();
  const [tab, setTab] = useState<string>(Tab.Settings);
  const [reveal, setReveal] = useState<string | undefined>();
  const select = (key: string | undefined) => {
    setSelected(key);
    if (key !== undefined) setTab(Tab.Step);
  };
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const blank = { title: PLAN_EDITOR_COPY.newStepTitle, roleKey: allowedRoles[0] ?? '', instructions: '' };
  const added = (next: { steps: RequiredStep[]; key: string }) => {
    onChange(next.steps);
    select(next.key);
    setReveal(next.key);
  };

  const remove = (key: string) => {
    onChange(steps.filter((s) => s.key !== key));
    if (selected === key) setSelected(undefined);
  };

  const shape = shapeDependencies(steps);
  const canvasSteps: CanvasStep[] = steps.map((s) => ({
    id: s.key,
    key: s.key,
    title: s.title === '' ? s.key : s.title,
    role: roleName(s.roleKey),
    dependsOn: shape.steps.get(s.key) ?? [],
    description: s.instructions.split('\n')[0] ?? '',
  }));
  const edit: CanvasEdit | undefined = readonly
    ? undefined
    : {
        canInsert: (a, b) => insertPosition(steps, a, b) !== undefined,
        canAddAfter: () => false,
        canAddParallel: () => false,
        canRemove: () => true,
        insert: (a, b) => added(insertRequired(steps, a, b, blank)),
        addAfter: () => undefined,
        addParallel: () => undefined,
        remove,
      };
  const index = steps.findIndex((s) => s.key === selected);
  const step = steps[index];

  const stepPanels = (
    <>
      <Panel title={PLAN_EDITOR_COPY.step}>
        {step === undefined || readonly ? (
          <p className="hint">{C.noRequiredSelection}</p>
        ) : (
          <RequiredStepForm
            step={step}
            taken={new Set(steps.filter((s) => s !== step).map((s) => s.position))}
            onChange={(next, field) => {
              onChange(
                steps.map((s, i) => (i === index ? next : s)),
                `${index}:${field}`,
              );
              setSelected(next.key);
            }}
            onRemove={() => remove(step.key)}
            allowedRoles={allowedRoles}
            roles={roles}
          />
        )}
      </Panel>
      <Panel title={PLAN_EDITOR_COPY.problems}>{problems}</Panel>
    </>
  );

  return (
    <div className={editorStyles.editor} data-testid="required-steps-editor">
      <div className={editorStyles.toolbar}>{toolbar(() => added(addRequired(steps, blank)))}</div>
      <div className={editorStyles.layout}>
        <div className={editorStyles.canvas}>
          <FlowCanvas
            steps={canvasSteps}
            label={CANVAS_COPY.workflowLabel}
            placeholder={{ id: PLANNED, title: C.plannedTitle, description: C.plannedHint, dependsOn: shape.planned }}
            selectedId={selected}
            onSelect={select}
            edit={edit}
            revealId={reveal}
            onRevealed={() => setReveal(undefined)}
          />
        </div>
        <aside className={editorStyles.side}>
          <Tabs
            value={tab}
            onValueChange={setTab}
            items={[
              { value: Tab.Step, label: PLAN_EDITOR_COPY.step, content: <div className="col">{stepPanels}</div> },
              { value: Tab.Settings, label: PLAN_EDITOR_COPY.settings, content: settings },
            ]}
          />
        </aside>
      </div>
    </div>
  );
}
