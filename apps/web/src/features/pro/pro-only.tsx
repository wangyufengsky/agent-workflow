import { UiMode } from '@aw/shared';
import type { ReactNode } from 'react';
import { Button } from '../../components/button.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { useSettings, useUpdateSettings } from '../settings/settings.queries.ts';

/** Pro pages opened in simple mode explain themselves instead of erroring or redirecting (14 §1). */
export function ProOnly({ children }: { children: ReactNode }) {
  const mode = useSettings()['ui.mode'];
  const update = useUpdateSettings();
  if (mode === UiMode.Pro) return children;
  return (
    <div className="page">
      <EmptyState
        icon="layers"
        title={COMMON_COPY.proOnlyTitle}
        body={COMMON_COPY.proOnlyBody}
        action={
          <Button variant="primary" pending={update.isPending} onClick={() => update.mutate({ 'ui.mode': UiMode.Pro })}>
            {COMMON_COPY.enablePro}
          </Button>
        }
      />
    </div>
  );
}
