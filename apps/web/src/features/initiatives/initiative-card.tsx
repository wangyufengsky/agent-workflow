import { type InitiativeSummaryDTO, STATUS_TONE } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { StatusBadge } from '../../components/status-badge.tsx';
import { INITIATIVES_COPY as C, INITIATIVE_STATUS_LABEL } from '../../copy/initiatives.ts';
import styles from './initiatives.module.css';

/** Progress of an initiative: work packages done out of all of them (34 §6.2). */
export function InitiativeProgress({ initiative }: { initiative: InitiativeSummaryDTO }) {
  const { doneCount, itemCount } = initiative;
  const label = C.progress(doneCount, itemCount);
  return (
    <div className="col">
      <div
        className={styles.meter}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={itemCount}
        aria-valuenow={doneCount}
      >
        <div className={styles.meterFill} style={{ width: `${(doneCount / itemCount) * 100}%` }} />
      </div>
      <div className="row">
        <StatusBadge
          tone={STATUS_TONE.initiative[initiative.status]}
          label={INITIATIVE_STATUS_LABEL[initiative.status]}
        />
        <span className="hint">{label}</span>
      </div>
    </div>
  );
}

/** An initiative in a list: title, template and project, and its progress. */
export function InitiativeCard({ initiative }: { initiative: InitiativeSummaryDTO }) {
  return (
    <Link
      to={ROUTES.initiative}
      params={{ initiativeId: initiative.id }}
      className="card pad col"
      data-testid="initiative-card"
    >
      <span className="section-title ellipsis">
        <span className="mono">{initiative.key}</span> · {initiative.title}
      </span>
      <span className="hint ellipsis">{C.meta(initiative.project.name, initiative.template?.name ?? null)}</span>
      <InitiativeProgress initiative={initiative} />
    </Link>
  );
}
