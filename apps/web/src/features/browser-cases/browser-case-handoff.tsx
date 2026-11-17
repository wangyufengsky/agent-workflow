import { type BrowserCaseHandoff, resumeBrowserCaseOp, takeBrowserCaseHandoffOp } from '@aw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { BROWSER_CASE_COPY as C } from '../../copy/browser-cases.ts';
import { usePlacedTab } from '../preview/use-placed-tab.ts';
import styles from './browser-case-handoff.module.css';

export function BrowserCaseHandoffPane({
  taskId,
  handoff,
  visible,
}: {
  taskId: string;
  handoff: BrowserCaseHandoff;
  visible: boolean;
}) {
  const area = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const bridge = window.aw;
  usePlacedTab(visible && handoff.active ? handoff.tabId : null, area, true);
  const change = useMutation({
    mutationFn: (resume: boolean) =>
      callOperation(resume ? resumeBrowserCaseOp : takeBrowserCaseHandoffOp, { id: taskId, handoffId: handoff.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.task(taskId), exact: true }),
  });
  return (
    <section className="col" aria-label={C.handoff.heading}>
      <strong>
        {C.handoff.reason[handoff.reason]} · {handoff.step === 0 ? C.opening : C.step(handoff.step)}
      </strong>
      {bridge === undefined ? (
        <p className="hint">{C.handoff.desktop}</p>
      ) : (
        <>
          <p className="hint">{handoff.active ? C.handoff.activeHint : C.handoff.takeHint}</p>
          <div className="row">
            <Button variant="primary" pending={change.isPending} onClick={() => change.mutate(handoff.active)}>
              {handoff.active ? C.handoff.resume : C.handoff.take}
            </Button>
            {handoff.active && (
              <Button size="sm" icon="refresh" onClick={() => bridge.browser.reload(handoff.tabId)}>
                {C.handoff.reload}
              </Button>
            )}
          </div>
          {change.isError && <ErrorState error={change.error} />}
          {handoff.active && <div ref={area} className={styles.surface} data-testid="case-handoff-surface" />}
        </>
      )}
    </section>
  );
}
