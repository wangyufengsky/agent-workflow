import {
  type RequirementItem,
  type RequirementItemInput,
  RequirementVerification,
  reverifyRequirementsOp,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { ErrorState } from '../../components/error-state.tsx';
import { CONFIRMATION_COPY as C } from '../../copy/assistant.ts';
import { REQUIREMENTS_COPY } from '../../copy/requirements.ts';
import { requirementsQuery } from '../requirements/requirements.queries.ts';
import styles from './cards.module.css';

export function requirementChanges(before: readonly RequirementItem[], after: readonly RequirementItemInput[]) {
  const previous = new Map(before.map((item) => [item.id, item]));
  const kept = new Set(after.flatMap((item) => (item.id === undefined ? [] : [item.id])));
  return [
    ...before.filter((item) => !kept.has(item.id)).map((item) => ({ before: item, after: undefined })),
    ...after.flatMap((item) => {
      const old = item.id === undefined ? undefined : previous.get(item.id);
      const same =
        old !== undefined &&
        old.title === item.title &&
        old.expected === item.expected &&
        old.required === (item.required ?? true) &&
        JSON.stringify(old.verification) ===
          JSON.stringify(item.verification ?? { kind: RequirementVerification.AiReview });
      return same ? [] : [{ before: old, after: item }];
    }),
  ];
}

function ItemText({ item }: { item: RequirementItemInput }) {
  const verification = item.verification ?? { kind: RequirementVerification.AiReview };
  return (
    <span>
      {item.title} · {C.requirementExpected(item.expected)} ·{' '}
      {item.required === false ? REQUIREMENTS_COPY.optional : REQUIREMENTS_COPY.required} ·{' '}
      {REQUIREMENTS_COPY.verificationLabel[verification.kind]}
      {verification.kind === RequirementVerification.Command ? `：${verification.command}` : ''}
    </span>
  );
}

export function RequirementsImpact({ input }: { input: Record<string, unknown> }) {
  const parsed = reverifyRequirementsOp.input.safeParse(input);
  if (!parsed.success || parsed.data.items === undefined) return null;
  return <ChecklistImpact taskId={parsed.data.id} revisionId={parsed.data.revisionId} items={parsed.data.items} />;
}

function ChecklistImpact({
  taskId,
  revisionId,
  items,
}: {
  taskId: string;
  revisionId: string | undefined;
  items: RequirementItemInput[];
}) {
  const query = useQuery(requirementsQuery(taskId));
  if (query.isPending) return <p className={styles.note}>{C.requirementsLoading}</p>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (revisionId === undefined || query.data.revision?.id !== revisionId)
    return <p className={styles.note}>{C.requirementsStale}</p>;
  const changes = requirementChanges(query.data.items, items);
  return (
    <div className={styles.note} data-testid="requirements-impact">
      <p>{C.requirementsScope}</p>
      {changes.length === 0 ? (
        <p>{C.requirementsUnchanged}</p>
      ) : (
        <ul>
          {changes.map((change, index) => (
            <li key={change.before?.id ?? `new-${index}`}>
              {change.before !== undefined && (
                <div>
                  {C.requirementsBefore} <ItemText item={change.before} />
                </div>
              )}
              {change.after !== undefined && (
                <div>
                  {C.requirementsAfter} <ItemText item={change.after} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
