import { type AttachmentDTO, AttachmentFormat, type FunctionalTestScope } from '@aw/shared';
import { useId } from 'react';
import { Icon } from '../../components/icon.tsx';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { BROWSER_TEST_COPY as B } from '../../copy/tasks.ts';
import styles from './functional-test-fields.module.css';

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
  const targetHintId = useId();
  const writesHintId = useId();
  return (
    <fieldset className={styles.scope}>
      <legend>{C.scope}</legend>
      <div className={styles.scopeGrid}>
        <label className={styles.field}>
          <span className={styles.fieldTitle}>{B.target}</span>
          <input
            className="input mono"
            aria-describedby={targetHintId}
            value={target}
            placeholder={C.targetPlaceholder}
            onChange={(event) => onTargetChange(event.target.value)}
          />
          <span className="hint" id={targetHintId}>
            {C.targetHint}
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldTitle}>{B.writes}</span>
          <textarea
            className={`input mono ${styles.writes}`}
            aria-describedby={writesHintId}
            rows={2}
            value={writes}
            placeholder={B.writesPlaceholder}
            onChange={(event) => onWritesChange(event.target.value)}
          />
          <span className="hint" id={writesHintId}>
            {B.writesHint}
          </span>
        </label>
      </div>
      <fieldset className={styles.caseFiles}>
        <legend>{C.caseInputs}</legend>
        <p className="hint">{C.caseInputHint}</p>
        {attachments.length > 0 && (
          <div className={styles.fileList}>
            {attachments.map((attachment) => (
              <label className={styles.caseChoice} key={attachment.id}>
                <input
                  type="checkbox"
                  checked={caseIds.includes(attachment.id)}
                  onChange={(event) => onCaseChange(attachment.id, event.target.checked)}
                />
                <Icon name={attachment.format === AttachmentFormat.Xlsx ? 'table' : 'file'} size="sm" />
                <span>{attachment.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label className={styles.field}>
        <span className={styles.fieldTitle}>{C.onFailure}</span>
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
      <label className={styles.approval}>
        <input
          type="checkbox"
          checked={approved}
          disabled={!valid}
          onChange={(event) => onApprovalChange(event.target.checked)}
        />
        <Icon name="shield" size="sm" />
        <span>{onFailure === undefined ? B.approved : C.approveWithFollowUp}</span>
      </label>
    </fieldset>
  );
}

export function FunctionalTestScopeSummary({ scope }: { scope: FunctionalTestScope }) {
  return (
    <dl className={styles.summary}>
      {scope.moduleSelection && (
        <>
          <dt>{C.selectedModule}</dt>
          <dd className="mono">
            {scope.moduleLaunch
              ? [scope.moduleLaunch.moduleName, scope.moduleLaunch.configurationName].join(' · ')
              : [scope.moduleSelection.moduleId, scope.moduleSelection.configurationId].filter(Boolean).join(' · ')}
          </dd>
        </>
      )}
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
