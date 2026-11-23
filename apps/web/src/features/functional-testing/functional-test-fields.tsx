import {
  type AttachmentDTO,
  AttachmentFormat,
  type FunctionalTestScope,
  type FunctionalTestServicePlan,
} from '@aw/shared';
import { useId } from 'react';
import { Icon } from '../../components/icon.tsx';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { PROJECT_MODULES_COPY as M } from '../../copy/project-modules.ts';
import { BROWSER_TEST_COPY as B } from '../../copy/tasks.ts';
import styles from './functional-test-fields.module.css';

export const canImportCaseAttachment = ({ format }: AttachmentDTO) =>
  format === AttachmentFormat.Text || format === AttachmentFormat.Docx || format === AttachmentFormat.Xlsx;

export function FunctionalTestFields({
  target,
  writes,
  services,
  serviceWrites,
  onServiceWritesChange,
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
  services: FunctionalTestServicePlan['services'];
  serviceWrites: Record<string, string>;
  onServiceWritesChange(id: string, value: string): void;
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
  const consent =
    services.length > 0
      ? onFailure === undefined
        ? C.approveCompound
        : C.approveCompoundFollowUp
      : onFailure === undefined
        ? B.approved
        : C.approveWithFollowUp;
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
            {services.length > 0 ? C.primaryServiceWritesHint : B.writesHint}
          </span>
        </label>
      </div>
      {services.length > 0 && (
        <details className={styles.caseFiles} open={Object.values(serviceWrites).some(Boolean) || undefined}>
          <summary>{C.serviceWrites}</summary>
          <p className="hint">{C.serviceWritesHint}</p>
          <div className={styles.scopeGrid}>
            {services.map(({ id, name, moduleId }) => (
              <label className={styles.field} key={id}>
                <span className={styles.fieldTitle}>{name ?? moduleId ?? id}</span>
                <textarea
                  className={`input mono ${styles.writes}`}
                  rows={2}
                  value={serviceWrites[id] ?? ''}
                  placeholder={B.writesPlaceholder}
                  onChange={(event) => onServiceWritesChange(id, event.target.value)}
                />
              </label>
            ))}
          </div>
        </details>
      )}
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
        <span>{consent}</span>
      </label>
    </fieldset>
  );
}

export function FunctionalTestScopeSummary({ scope }: { scope: FunctionalTestScope }) {
  const plan = scope.compoundLaunch?.plan;
  const target = scope.compoundSelection?.targetServiceId ?? plan?.targetServiceId;
  const serviceLabel = (id: string) => plan?.services.find((service) => service.id === id)?.name ?? id;
  const defaultWriteTarget =
    target !== undefined ? serviceLabel(target) : scope.compoundSelection ? C.defaultTargetService : undefined;
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
      {scope.compoundSelection && (
        <>
          <dt>{C.selectedCompound}</dt>
          <dd className="mono">{scope.compoundLaunch?.compoundName ?? scope.compoundSelection.compoundId}</dd>
        </>
      )}
      {target !== undefined && (
        <>
          <dt>{M.targetService}</dt>
          <dd className="mono">{serviceLabel(target)}</dd>
        </>
      )}
      <dt>{B.target}</dt>
      <dd className="mono">{scope.target}</dd>
      <dt>{B.writes}</dt>
      <dd className="mono">
        {scope.writes
          .map(({ method, path, serviceId }) => {
            const label = serviceId === undefined ? defaultWriteTarget : serviceLabel(serviceId);
            return label === undefined ? `${method} ${path}` : `${label} · ${method} ${path}`;
          })
          .join('、') || B.noWrites}
      </dd>
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
