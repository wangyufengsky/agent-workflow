import {
  type AttachmentDTO,
  type FunctionalTestCase,
  type FunctionalTestEvent,
  type FunctionalTestSnapshot,
  type FunctionalTestStep,
  functionalTestApproveRevisionOp,
} from '@aw/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { formatDateTime } from '../../copy/common.ts';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { AttachmentPreview } from '../attachments/attachment-preview.tsx';
import styles from './functional-test.module.css';

function Steps({ items }: { items: readonly FunctionalTestStep[] }) {
  return (
    <ol className={styles.items}>
      {items.map((step, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 用例步骤以该版本内的顺序编号。
        <li key={`${index}:${step.title}`}>
          <strong>{step.title}</strong>
          {step.kind === 'http' ? (
            <>
              <div className="mono">
                {step.method} {step.path}
              </div>
              {step.body !== undefined && <pre>{JSON.stringify(step.body, null, 2)}</pre>}
              {step.assertions.map(({ field, equals, basis }) => (
                <p key={`${field}:${basis}`}>
                  <code>
                    {field} = {JSON.stringify(equals)}
                  </code>{' '}
                  · {basis}
                </p>
              ))}
            </>
          ) : (
            <>
              <pre>{JSON.stringify({ action: step.action, expect: step.expect }, null, 2)}</pre>
              <p>{step.basis}</p>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

export function CaseDefinition({
  taskId,
  item,
  attachments,
  revisions,
}: {
  taskId: string;
  item: FunctionalTestCase;
  attachments: readonly AttachmentDTO[];
  revisions: readonly FunctionalTestEvent[];
}) {
  const [preview, setPreview] = useState<AttachmentDTO>();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.functionalTest(taskId);
  const snapshot = queryClient.getQueryData<FunctionalTestSnapshot>(queryKey);
  const current = snapshot?.cases.findLast(({ id }) => id === item.id);
  const saved = snapshot?.events.findLast(
    (event) => event.caseId === item.id && event.kind === 'case' && event.detail.version === item.version,
  );
  const approve = useMutation({
    mutationFn: (proposal: number) => callOperation(functionalTestApproveRevisionOp, { taskId, proposal }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const source = item.source;
  const attachment = attachments.find(({ id }) => id === source?.attachmentId);
  return (
    <article className={styles.definition}>
      <h3>
        {item.number} · {item.title}
      </h3>
      <p className="hint">
        {C.version(item.version)}
        {saved !== undefined && ` · ${C.savedAt(formatDateTime(saved.at))}`}
        {typeof saved?.detail.author === 'string' && ` · ${C.actor(saved.detail.author)}`}
      </p>
      {source !== undefined && (
        <div className="row wrap">
          <span>{[attachment?.name, source.originalId, source.location].filter(Boolean).join(' · ')}</span>
          {attachment !== undefined && (
            <Button size="sm" onClick={() => setPreview(attachment)}>
              {C.source}
            </Button>
          )}
        </div>
      )}
      {preview !== undefined && (
        <AttachmentPreview id={preview.id} name={preview.name} onClose={() => setPreview(undefined)} />
      )}
      {item.needsClarification !== undefined && (
        <p>
          <strong>{C.clarification}</strong> · {item.needsClarification}
        </p>
      )}
      <h4>{C.requirement}</h4>
      <p>{item.requirement}</p>
      {item.preconditions.length > 0 && (
        <>
          <h4>{C.condition}</h4>
          <ul className={styles.items}>
            {item.preconditions.map((condition, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 前置条件可重复，列表行没有独立状态。
              <li key={`${index}:${condition}`}>{condition}</li>
            ))}
          </ul>
        </>
      )}
      {item.data !== '' && (
        <>
          <h4>{C.data}</h4>
          <pre>{item.data}</pre>
        </>
      )}
      {item.steps.length > 0 && (
        <>
          <h4>{C.steps}</h4>
          <Steps items={item.steps} />
        </>
      )}
      {item.cleanup.length > 0 && (
        <>
          <h4>{C.cleanup}</h4>
          <Steps items={item.cleanup} />
        </>
      )}
      {revisions.length > 0 && (
        <>
          <h4>{C.revision}</h4>
          {revisions.map((event) => (
            <details key={event.seq}>
              <summary>
                {formatDateTime(event.at)} · {event.message}
              </summary>
              <pre>{JSON.stringify(event.detail, null, 2)}</pre>
              {event.detail.pending === true &&
                current?.version === event.detail.from &&
                !snapshot?.reports.some(({ runId }) => runId === event.runId) && (
                  <Button size="sm" pending={approve.isPending} onClick={() => approve.mutate(event.seq)}>
                    {C.approveRevision}
                  </Button>
                )}
              {approve.isError && approve.variables === event.seq && <ErrorState error={approve.error} />}
            </details>
          ))}
        </>
      )}
    </article>
  );
}
