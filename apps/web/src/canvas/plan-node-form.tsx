import type { PlanGraph, PlanNodeSpec, RoleDTO } from '@aw/shared';
import { useState } from 'react';
import { Button } from '../components/button.tsx';
import { PLAN_EDITOR_COPY as C } from '../copy/plan-editor.ts';
import { AcceptanceEditor } from './acceptance-editor.tsx';
import { type NodePatch, renameProblem } from './plan-graph-edit.ts';

type Props = {
  graph: PlanGraph;
  node: PlanNodeSpec;
  /** Role keys the step may use. */
  allowedRoles: readonly string[];
  roles: readonly RoleDTO[];
  locked: boolean;
  onPatch: (patch: NodePatch) => void;
  onRename: (key: string) => void;
  onRemove: () => void;
};

/** The key is committed on blur or Enter once it is valid and free; until then the field shows why not. */
function KeyField({ graph, node, locked, onRename }: Pick<Props, 'graph' | 'node' | 'locked' | 'onRename'>) {
  const [draft, setDraft] = useState(node.key);
  const problem = renameProblem(graph, node.key, draft);
  const commit = () => {
    if (problem === null && draft !== node.key) onRename(draft);
  };
  return (
    <div className="field">
      <label className="label" htmlFor="plan-node-key">
        {C.key}
      </label>
      <input
        id="plan-node-key"
        className="input mono"
        value={draft}
        disabled={locked}
        aria-invalid={problem !== null}
        aria-describedby="plan-node-key-hint"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <span id="plan-node-key-hint" className={problem === null ? 'hint' : 'error-text'}>
        {problem === 'pattern' ? C.keyPattern : problem === 'taken' ? C.keyTaken : C.keyHint}
      </span>
    </div>
  );
}

/** Fields of the selected step (14 §5): dependencies as checkboxes too, so the plan can be edited without dragging. */
export function PlanNodeForm({ graph, node, allowedRoles, roles, locked, onPatch, onRename, onRemove }: Props) {
  const others = graph.nodes.filter((n) => n.key !== node.key);
  const roleKeys = allowedRoles.includes(node.roleKey) ? allowedRoles : [...allowedRoles, node.roleKey];
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  return (
    <div className="col" data-testid="plan-node-form">
      {locked && <p className="hint">{C.lockedNote}</p>}
      {/* Remounted per step so the key draft starts from the selected step. */}
      <KeyField key={node.key} graph={graph} node={node} locked={locked} onRename={onRename} />
      <div className="field">
        <label className="label" htmlFor="plan-node-title">
          {C.title}
        </label>
        <input
          id="plan-node-title"
          className="input"
          value={node.title}
          disabled={locked}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="plan-node-role">
          {C.role}
        </label>
        <select
          id="plan-node-role"
          className="select"
          value={node.roleKey}
          disabled={locked}
          onChange={(e) => onPatch({ roleKey: e.target.value })}
        >
          {roleKeys.map((key) => (
            <option key={key} value={key}>
              {roleName(key)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="plan-node-instructions">
          {C.instructions}
        </label>
        <textarea
          id="plan-node-instructions"
          className="textarea"
          rows={5}
          value={node.instructions}
          disabled={locked}
          onChange={(e) => onPatch({ instructions: e.target.value })}
        />
      </div>
      <fieldset className="col" disabled={locked}>
        <legend className="label">{C.dependsOn}</legend>
        {others.length === 0 && <span className="hint">{C.noOtherSteps}</span>}
        {others.map((other) => (
          <label key={other.key} className="check">
            <input
              type="checkbox"
              checked={node.dependsOn.includes(other.key)}
              onChange={(e) =>
                onPatch({
                  dependsOn: e.target.checked
                    ? [...node.dependsOn, other.key]
                    : node.dependsOn.filter((key) => key !== other.key),
                })
              }
            />
            <span>{other.title === '' ? other.key : other.title}</span>
          </label>
        ))}
      </fieldset>
      <AcceptanceEditor
        idPrefix="plan-node"
        value={node.acceptance}
        onChange={(acceptance) => onPatch({ acceptance })}
        disabled={locked}
        allowDefault
      />
      {!locked && (
        <div className="row">
          <Button variant="danger" size="sm" icon="trash" onClick={onRemove}>
            {C.removeStep}
          </Button>
        </div>
      )}
    </div>
  );
}
