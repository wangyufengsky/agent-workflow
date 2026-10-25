import { MasterPasswordState } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { UnlockForm } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { ONBOARDING_COPY } from '../../copy/onboarding.ts';
import { environmentQuery } from '../../features/onboarding/environment.queries.ts';

/**
 * While the master password has not been entered since start, on every page (D178): what needs a token or a
 * database password fails until then, schedules and AI steps included, and the user may never open the checks.
 */
export function CredentialsBanner() {
  const { data } = useQuery(environmentQuery);
  if (data?.credentials.masterPassword !== MasterPasswordState.Locked) return null;
  return (
    <section className="banner warn shell-banner" aria-label={ONBOARDING_COPY.credentials.title}>
      <Icon name="lock" />
      <div className="grow col">
        <span>{ONBOARDING_COPY.credentials.lockedBanner}</span>
        <UnlockForm />
      </div>
    </section>
  );
}
