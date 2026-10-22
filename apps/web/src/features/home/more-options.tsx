import { TASK_TITLE_MAX_CHARS } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { HOME_TASK_COPY as C } from '../../copy/tasks.ts';
import { gitBranchesQuery } from '../git/git.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import styles from './home.module.css';

/** Pro mode's「更多选项」(M5-09): title, base branch, every checkpoint; null fields use the defaults. */
export type MoreOptions = {
  title: string;
  baseBranch: string | null;
  acceptEachNode: boolean | null;
  askOnUncertainty: boolean | null;
};
export const NO_OPTIONS: MoreOptions = { title: '', baseBranch: null, acceptEachNode: null, askOnUncertainty: null };

export function MoreOptionsFields({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: MoreOptions;
  onChange: (value: MoreOptions) => void;
}) {
  const branches = useQuery({ ...gitBranchesQuery(projectId), enabled: projectId !== '' });
  const askDefault = useSettings()['ai.askOnUncertainty'];
  const local = branches.data?.filter((b) => !b.remote) ?? [];
  return (
    <details className={styles.more}>
      <summary className="hint">{C.moreOptions}</summary>
      <div className="grid-2">
        <div>
          <div className="field">
            <label className="label" htmlFor="start-title">
              {C.title}
            </label>
            <input
              id="start-title"
              className="input"
              maxLength={TASK_TITLE_MAX_CHARS}
              placeholder={C.titlePlaceholder}
              value={value.title}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="start-branch">
            {C.baseBranch}
          </label>
          <select
            id="start-branch"
            className="select"
            value={value.baseBranch ?? ''}
            onChange={(e) => onChange({ ...value, baseBranch: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">{C.defaultBranch}</option>
            {local.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={value.acceptEachNode ?? false}
          onChange={(e) => onChange({ ...value, acceptEachNode: e.target.checked })}
        />
        <span>{C.acceptEachNode}</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value.askOnUncertainty ?? askDefault}
          onChange={(e) => onChange({ ...value, askOnUncertainty: e.target.checked })}
        />
        <span>{C.askOnUncertainty}</span>
      </label>
    </details>
  );
}
