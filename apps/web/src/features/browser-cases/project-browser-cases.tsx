import { type BrowserCase, listBrowserCasesOp, runBrowserCaseOp } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { BROWSER_CASE_COPY as C } from '../../copy/browser-cases.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { BrowserCaseEditor, browserCasesKey } from './browser-case-editor.tsx';
import { BrowserCaseRun } from './browser-case-run.tsx';

export function ProjectBrowserCases({ projectId }: { projectId: string }) {
  const cases = useQuery({
    queryKey: browserCasesKey(projectId),
    queryFn: () => callOperation(listBrowserCasesOp, { projectId }),
  });
  const [editing, setEditing] = useState<BrowserCase | 'new'>();
  return (
    <Panel title={C.title}>
      <div className="col">
        <div className="row">
          <Button icon="plus" size="sm" onClick={() => setEditing('new')}>
            {C.newCase}
          </Button>
        </div>
        {cases.isError && <ErrorState error={cases.error} onRetry={() => void cases.refetch()} />}
        {cases.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        {cases.data?.items.length === 0 && <p className="hint">{C.empty}</p>}
        {cases.data?.items.map((test) => (
          <div key={test.caseId} className="row">
            <div className="grow">
              <strong>{test.name}</strong>
              <p className="hint">
                {test.scope.target} · {C.revision(test.revision)}
              </p>
            </div>
            <Button size="sm" onClick={() => setEditing(test)}>
              {C.edit}
            </Button>
            <BrowserCaseRun
              key={test.revision}
              test={test}
              label={C.run}
              launch={() =>
                callOperation(runBrowserCaseOp, {
                  projectId,
                  caseId: test.caseId,
                  revision: test.revision,
                  approved: true,
                })
              }
            />
          </div>
        ))}
      </div>
      {editing !== undefined && (
        <BrowserCaseEditor
          projectId={projectId}
          {...(editing === 'new' ? {} : { test: editing })}
          onClose={() => setEditing(undefined)}
        />
      )}
    </Panel>
  );
}
