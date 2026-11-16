import { getRequirementHistoryOp, RequirementVerification, type TaskRequirementsDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { REQUIREMENTS_COPY as C } from '../../copy/requirements.ts';

import styles from './requirements.module.css';

export function RequirementsHistory({
  taskId,
  revisions,
}: {
  taskId: string;
  revisions: TaskRequirementsDTO['history'];
}) {
  return (
    <details>
      <summary>{C.history}</summary>
      {revisions.map((revision) => (
        <HistoryVersion key={revision.id} taskId={taskId} revision={revision} />
      ))}
    </details>
  );
}

function HistoryVersion({ taskId, revision }: { taskId: string; revision: TaskRequirementsDTO['history'][number] }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [...queryKeys.taskRequirements(taskId), 'history', revision.id],
    queryFn: () => callOperation(getRequirementHistoryOp, { id: taskId, revisionId: revision.id }),
    enabled: open,
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{C.historyVersion(revision.seq, new Date(revision.createdAt).toLocaleString())}</summary>
      {open && query.isPending && <p className="hint">{C.historyLoading}</p>}
      {open && query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {open &&
        query.data?.items.map((item) => (
          <div key={item.id}>
            <strong>{item.title}</strong>
            <p>
              {C.expectedIs(item.expected)} · {item.required ? C.required : C.optional} ·{' '}
              {C.verificationLabel[item.verification.kind]}
            </p>
            {item.verification.kind === RequirementVerification.Command && (
              <pre className={styles.output}>{item.verification.command}</pre>
            )}
            {item.results.length === 0 && <p className="hint">{C.historyNoResult}</p>}
            {item.results.map((result) => (
              <div key={result.id}>
                <p>
                  {C.conclusionLabel[result.conclusion]} · {C.sourceLabel[result.source]} ·{' '}
                  {new Date(result.createdAt).toLocaleString()} · {C.historyCommit(result.commitSha)}
                </p>
                {result.note !== '' && <Markdown source={result.note} />}
                {result.output !== null && result.output !== '' && <pre className={styles.output}>{result.output}</pre>}
              </div>
            ))}
          </div>
        ))}
    </details>
  );
}
