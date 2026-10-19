import { STATUS_TONE, UiMode } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RUNTIME_STATUS_LABEL } from '../../copy/runtime.ts';
import { runtimeQuery } from '../../features/runtime/runtime.queries.ts';
import { useSettings } from '../../features/settings/settings.queries.ts';
import { ROUTES } from '../routes.ts';

/** Sidebar runtime indicator (14 §2): simple mode opens the environment checks, pro mode the runtime page. */
export function RuntimeChip() {
  const mode = useSettings()['ui.mode'];
  // Live through runtime.updated (api/server-events.ts).
  const { data } = useQuery(runtimeQuery);
  if (data === undefined) return null;
  const { status } = data;
  return (
    <Link
      to={mode === UiMode.Pro ? ROUTES.runtime : ROUTES.onboarding}
      className="runtime-chip"
      data-testid="runtime-chip"
    >
      <span className={`dot tone-${STATUS_TONE.runtime[status]}`} aria-hidden="true" />
      <span className="hint">{RUNTIME_STATUS_LABEL[status]}</span>
    </Link>
  );
}
