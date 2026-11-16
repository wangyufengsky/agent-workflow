import { type ProjectDTO, TASK_TITLE_MAX_CHARS } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { Icon } from '../../components/icon.tsx';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { gitBranchesQuery } from '../git/git.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import styles from './more-options.module.css';

/** null 字段沿用默认设置。 */
export type MoreOptions = {
  title: string;
  baseBranch: string | null;
  acceptEachNode: boolean | null;
  askOnUncertainty: boolean | null;
};
export const NO_OPTIONS: MoreOptions = { title: '', baseBranch: null, acceptEachNode: null, askOnUncertainty: null };

function ConfirmationSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.switchRow}>
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function MoreOptionsFields({
  id,
  project,
  value,
  onChange,
  confirmPlan,
  onConfirmPlanChange,
}: {
  id: string;
  project: ProjectDTO;
  value: MoreOptions;
  onChange: (value: MoreOptions) => void;
  confirmPlan: boolean;
  onConfirmPlanChange: (checked: boolean) => void;
}) {
  const fieldId = useId();
  const branches = useQuery(gitBranchesQuery(project.id));
  const askDefault = useSettings()['ai.askOnUncertainty'];
  const local = branches.data?.filter((b) => !b.remote) ?? [];

  return (
    <section id={id} aria-label={C.moreOptions} className={styles.panel}>
      <div className={styles.layout}>
        <section className={styles.identity} aria-labelledby={`${fieldId}-info`}>
          <h3 id={`${fieldId}-info`} className={styles.heading}>
            <Icon name="file" size="sm" />
            {C.taskInfo}
          </h3>
          <label className={styles.field}>
            <span>{C.title}</span>
            <input
              className="input"
              maxLength={TASK_TITLE_MAX_CHARS}
              placeholder={C.titlePlaceholder}
              value={value.title}
              onChange={(event) => onChange({ ...value, title: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span>{C.baseBranch}</span>
            <span className={styles.branch}>
              <Icon name="branch" size="sm" />
              <select
                className="select"
                value={value.baseBranch ?? ''}
                onChange={(event) => onChange({ ...value, baseBranch: event.target.value || null })}
              >
                <option value="">{C.defaultBranch(project.defaultBranch)}</option>
                {local.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </section>
        <section className={styles.confirmation} aria-labelledby={`${fieldId}-confirmation`}>
          <h3 id={`${fieldId}-confirmation`} className={styles.heading}>
            <Icon name="shield" size="sm" />
            {C.executionConfirmation}
          </h3>
          <ConfirmationSwitch label={C.confirmPlan} checked={confirmPlan} onChange={onConfirmPlanChange} />
          <ConfirmationSwitch
            label={C.acceptEachNode}
            checked={value.acceptEachNode ?? false}
            onChange={(acceptEachNode) => onChange({ ...value, acceptEachNode })}
          />
          <ConfirmationSwitch
            label={C.askOnUncertainty}
            checked={value.askOnUncertainty ?? askDefault}
            onChange={(askOnUncertainty) => onChange({ ...value, askOnUncertainty })}
          />
        </section>
      </div>
    </section>
  );
}
