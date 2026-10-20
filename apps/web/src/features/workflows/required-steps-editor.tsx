import { type RequiredStep, RequiredStepPosition, type RoleDTO } from '@aw/shared';
import { AcceptanceEditor } from '../../canvas/acceptance-editor.tsx';
import { Button } from '../../components/button.tsx';
import { WORKFLOW_EDITOR_COPY as C } from '../../copy/workflows.ts';
import styles from './workflows.module.css';

const POSITION_LABEL = {
  [RequiredStepPosition.First]: C.positionFirst,
  [RequiredStepPosition.Last]: C.positionLast,
} as const;

/** A step's fields with the optional ones left out when empty (exactOptionalPropertyTypes). */
function withPosition(step: RequiredStep, position: string): RequiredStep {
  const { position: _old, ...rest } = step;
  return position === RequiredStepPosition.First || position === RequiredStepPosition.Last
    ? { ...rest, position }
    : rest;
}

/** Steps every AI plan of the workflow must contain (10 §workflows `requiredSteps`, 08 §5.3). */
export function RequiredStepsEditor({
  steps,
  onChange,
  allowedRoles,
  roles,
}: {
  steps: readonly RequiredStep[];
  onChange: (steps: RequiredStep[]) => void;
  allowedRoles: readonly string[];
  roles: readonly RoleDTO[];
}) {
  const set = (index: number, step: RequiredStep) => onChange(steps.map((s, i) => (i === index ? step : s)));
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  const add = () => {
    const taken = new Set(steps.map((s) => s.key));
    let n = steps.length + 1;
    while (taken.has(`required_${n}`)) n += 1;
    onChange([
      ...steps,
      { key: `required_${n}`, title: '', roleKey: allowedRoles[0] ?? '', instructions: '', dependsOn: [] },
    ]);
  };
  return (
    <div className="col">
      <p className="hint">{C.requiredHint}</p>
      {steps.map((step, index) => {
        const id = `required-${index}`;
        return (
          // Keys may be edited, so the position identifies the card while typing.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <fieldset key={index} className="card pad col" aria-label={step.title === '' ? step.key : step.title}>
            <div className={styles.fieldGrid}>
              <div className="field">
                <label className="label" htmlFor={`${id}-key`}>
                  {C.stepKey}
                </label>
                <input
                  id={`${id}-key`}
                  className="input mono"
                  value={step.key}
                  onChange={(e) => set(index, { ...step, key: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`${id}-title`}>
                  {C.stepTitle}
                </label>
                <input
                  id={`${id}-title`}
                  className="input"
                  value={step.title}
                  onChange={(e) => set(index, { ...step, title: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`${id}-role`}>
                  {C.stepRole}
                </label>
                <select
                  id={`${id}-role`}
                  className="select"
                  value={step.roleKey}
                  onChange={(e) => set(index, { ...step, roleKey: e.target.value })}
                >
                  {(allowedRoles.includes(step.roleKey) ? allowedRoles : [...allowedRoles, step.roleKey]).map((key) => (
                    <option key={key} value={key}>
                      {roleName(key)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor={`${id}-position`}>
                  {C.position}
                </label>
                <select
                  id={`${id}-position`}
                  className="select"
                  value={step.position ?? ''}
                  onChange={(e) => set(index, withPosition(step, e.target.value))}
                >
                  <option value="">{C.positionNone}</option>
                  {Object.values(RequiredStepPosition).map((p) => (
                    <option key={p} value={p}>
                      {POSITION_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor={`${id}-instructions`}>
                {C.stepInstructions}
              </label>
              <textarea
                id={`${id}-instructions`}
                className="textarea"
                rows={3}
                value={step.instructions}
                onChange={(e) => set(index, { ...step, instructions: e.target.value })}
              />
            </div>
            <AcceptanceEditor
              idPrefix={id}
              value={step.acceptance}
              onChange={(acceptance) => {
                const { acceptance: _old, ...rest } = step;
                set(index, acceptance === undefined ? rest : { ...rest, acceptance });
              }}
              allowDefault
            />
            <div className="row">
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                onClick={() => onChange(steps.filter((_, i) => i !== index))}
              >
                {C.removeRequired}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <div className="row">
        <Button size="sm" icon="plus" onClick={add}>
          {C.addRequired}
        </Button>
      </div>
    </div>
  );
}
