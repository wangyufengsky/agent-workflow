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

type Props = {
  step: RequiredStep;
  /** Positions another step already has: a second `first` or `last` step could never be satisfied. */
  taken: ReadonlySet<RequiredStep['position']>;
  /** A changed step; `field` names what changed, so typing into one field is one undo step. */
  onChange: (step: RequiredStep, field: string) => void;
  onRemove: () => void;
  allowedRoles: readonly string[];
  roles: readonly RoleDTO[];
};

/** One step every AI plan of the workflow must contain (10 §workflows `requiredSteps`, 08 §5.3; 26 §6.3). */
export function RequiredStepForm({ step, taken, onChange, onRemove, allowedRoles, roles }: Props) {
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  return (
    <div className="col" data-testid="required-step-form">
      <div className={styles.fieldGrid}>
        <div className="field">
          <label className="label" htmlFor="required-key">
            {C.stepKey}
          </label>
          <input
            id="required-key"
            className="input mono"
            value={step.key}
            onChange={(e) => onChange({ ...step, key: e.target.value }, 'key')}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="required-position">
            {C.position}
          </label>
          <select
            id="required-position"
            className="select"
            value={step.position ?? ''}
            onChange={(e) => onChange(withPosition(step, e.target.value), 'position')}
          >
            <option value="">{C.positionNone}</option>
            {Object.values(RequiredStepPosition).map((p) => (
              <option key={p} value={p} disabled={taken.has(p)}>
                {POSITION_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="required-title">
          {C.stepTitle}
        </label>
        <input
          id="required-title"
          className="input"
          value={step.title}
          onChange={(e) => onChange({ ...step, title: e.target.value }, 'title')}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="required-role">
          {C.stepRole}
        </label>
        <select
          id="required-role"
          className="select"
          value={step.roleKey}
          onChange={(e) => onChange({ ...step, roleKey: e.target.value }, 'role')}
        >
          {(allowedRoles.includes(step.roleKey) ? allowedRoles : [...allowedRoles, step.roleKey]).map((key) => (
            <option key={key} value={key}>
              {roleName(key)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="required-instructions">
          {C.stepInstructions}
        </label>
        <textarea
          id="required-instructions"
          className="textarea"
          rows={4}
          value={step.instructions}
          onChange={(e) => onChange({ ...step, instructions: e.target.value }, 'instructions')}
        />
      </div>
      <AcceptanceEditor
        key={step.key}
        idPrefix="required"
        value={step.acceptance}
        onChange={(acceptance) => {
          const { acceptance: _old, ...rest } = step;
          onChange(acceptance === undefined ? rest : { ...rest, acceptance }, 'acceptance');
        }}
        allowDefault
      />
      <div className="row">
        <Button variant="danger" size="sm" icon="trash" onClick={onRemove}>
          {C.removeRequired}
        </Button>
      </div>
    </div>
  );
}
