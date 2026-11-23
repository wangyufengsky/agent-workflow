import { type AttachmentDTO, AttachmentFormat, type FunctionalTestScope } from '@aw/shared';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { BROWSER_TEST_COPY as B } from '../../copy/tasks.ts';

export const canImportCaseAttachment = ({ format }: AttachmentDTO) =>
  format === AttachmentFormat.Text || format === AttachmentFormat.Docx || format === AttachmentFormat.Xlsx;

export function FunctionalTestFields({
  target,
  writes,
  attachments,
  caseIds,
  onFailure,
  approved,
  valid,
  onTargetChange,
  onWritesChange,
  onCaseChange,
  onFailureChange,
  onApprovalChange,
}: {
  target: string;
  writes: string;
  attachments: readonly AttachmentDTO[];
  caseIds: readonly string[];
  onFailure: FunctionalTestScope['onFailure'];
  approved: boolean;
  valid: boolean;
  onTargetChange(value: string): void;
  onWritesChange(value: string): void;
  onCaseChange(id: string, checked: boolean): void;
  onFailureChange(value: FunctionalTestScope['onFailure']): void;
  onApprovalChange(value: boolean): void;
}) {
  return (
    <fieldset className="col">
      <legend>{C.scope}</legend>
      <label className="col">
        {B.target}
        <input
          className="input"
          value={target}
          placeholder={C.targetPlaceholder}
          onChange={(event) => onTargetChange(event.target.value)}
        />
        <span className="hint">{C.targetHint}</span>
      </label>
      <label className="col">
        {B.writes}
        <textarea
          className="input mono"
          rows={2}
          value={writes}
          placeholder={B.writesPlaceholder}
          onChange={(event) => onWritesChange(event.target.value)}
        />
        <span className="hint">{B.writesHint}</span>
      </label>
      <fieldset className="col">
        <legend>{C.caseInputs}</legend>
        <span className="hint">{C.caseInputHint}</span>
        {attachments.map((attachment) => (
          <label key={attachment.id}>
            <input
              type="checkbox"
              checked={caseIds.includes(attachment.id)}
              onChange={(event) => onCaseChange(attachment.id, event.target.checked)}
            />
            {attachment.name}
          </label>
        ))}
      </fieldset>
      <label className="col">
        {C.onFailure}
        <select
          className="input"
          value={onFailure ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onFailureChange(value === 'repair' || value === 'repair_and_retest' ? value : undefined);
          }}
        >
          <option value="">{C.reportOnly}</option>
          <option value="repair">{C.autoRepair}</option>
          <option value="repair_and_retest">{C.autoRetest}</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={approved}
          disabled={!valid}
          onChange={(event) => onApprovalChange(event.target.checked)}
        />
        {onFailure === undefined ? B.approved : C.approveWithFollowUp}
      </label>
    </fieldset>
  );
}

export function FunctionalTestScopeSummary({ scope }: { scope: FunctionalTestScope }) {
  return (
    <dl className="col">
      <dt>{B.target}</dt>
      <dd className="mono">{scope.target}</dd>
      <dt>{B.writes}</dt>
      <dd className="mono">{scope.writes.map(({ method, path }) => `${method} ${path}`).join('、') || B.noWrites}</dd>
      <dt>{C.onFailure}</dt>
      <dd>
        {scope.onFailure === 'repair'
          ? C.autoRepair
          : scope.onFailure === 'repair_and_retest'
            ? C.autoRetest
            : C.reportOnly}
      </dd>
    </dl>
  );
}
