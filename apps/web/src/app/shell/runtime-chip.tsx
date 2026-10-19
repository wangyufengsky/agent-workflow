import { RuntimeStatus, StatusTone, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RUNTIME_STATUS_LABEL } from '../../copy/runtime.ts';
import { environmentQuery } from '../../features/onboarding/environment.queries.ts';
import { useSettings } from '../../features/settings/settings.queries.ts';
import { ROUTES } from '../routes.ts';

const TONE: Record<RuntimeStatus, StatusTone> = {
  [RuntimeStatus.Ready]: StatusTone.Ok,
  [RuntimeStatus.Starting]: StatusTone.Run,
  [RuntimeStatus.Stopped]: StatusTone.Wait,
  [RuntimeStatus.NotInstalled]: StatusTone.Danger,
  [RuntimeStatus.VersionMismatch]: StatusTone.Danger,
  [RuntimeStatus.Crashed]: StatusTone.Danger,
};

/** Sidebar runtime indicator (14 §2): simple mode opens the environment checks, pro mode the runtime page. */
export function RuntimeChip() {
  const mode = useSettings()['ui.mode'];
  const { data } = useQuery(environmentQuery);
  if (data === undefined) return null;
  const status = data.opencode.status;
  return (
    <Link
      to={mode === UiMode.Pro ? ROUTES.runtime : ROUTES.onboarding}
      className="runtime-chip"
      data-testid="runtime-chip"
    >
      <span className={`dot tone-${TONE[status]}`} aria-hidden="true" />
      <span className="hint">{RUNTIME_STATUS_LABEL[status]}</span>
    </Link>
  );
}
