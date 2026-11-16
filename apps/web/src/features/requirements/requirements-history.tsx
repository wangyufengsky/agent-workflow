import { getRequirementHistoryOp, RequirementVerification, type TaskRequirementsDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Markdown } from '../../components/markdown.tsx';
import { REQUIREMENTS_COPY as C } from '../../copy/requirements.ts';

import styles from './requirements.module.css';

const focusItem = (element: HTMLElement | null) => element?.focus();

export function RequirementsHistory({
  taskId,
  revisions,
  itemId,
  revisionId,
}: {
  taskId: string;
  revisions: TaskRequirementsDTO['history'];
  itemId: string | undefined;
  revisionId: string | undefined;
}) {
  return (
    <details open={revisionId !== undefined || undefined}>
      <summary>{C.history}</summary>
      {revisions.map((revision) => (
        <HistoryVersion
          key={revision.id}
          taskId={taskId}
          revision={revision}
          itemId={revision.id === revisionId ? itemId : undefined}
        />
      ))}
    </details>
  );
}

function HistoryVersion({
  taskId,
  revision,
  itemId,
}: {
  taskId: string;
  revision: TaskRequirementsDTO['history'][number];
  itemId: string | undefined;
}) {
  const [open, setOpen] = useState(itemId !== undefined);
  const load = open || itemId !== undefined;
  const query = useQuery({
    queryKey: [...queryKeys.taskRequirements(taskId), 'history', revision.id],
    queryFn: () => callOperation(getRequirementHistoryOp, { id: taskId, revisionId: revision.id }),
    enabled: load,
  });
  return (
    <details open={itemId !== undefined || undefined} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{C.historyVersion(revision.seq, new Date(revision.createdAt).toLocaleString())}</summary>
      {load && query.isPending && <p className="hint">{C.historyLoading}</p>}
      {load && query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {load &&
        query.data?.items.map((item) => (
          <div key={item.id}>
            <strong ref={item.id === itemId ? focusItem : undefined} tabIndex={item.id === itemId ? -1 : undefined}>
              {item.title}
            </strong>
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
                {result.nodeId != null && (
                  <Link to={ROUTES.node} params={{ taskId, nodeId: result.nodeId }} search={{}}>
                    {C.viewVerificationNode}
                  </Link>
                )}
                {result.note !== '' && <Markdown source={result.note} />}
                {result.output !== null && result.output !== '' && <pre className={styles.output}>{result.output}</pre>}
              </div>
            ))}
          </div>
        ))}
    </details>
  );
}
