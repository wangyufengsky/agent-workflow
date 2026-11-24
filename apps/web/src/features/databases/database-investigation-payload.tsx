import { investigateDatabaseInputSchema, listDatabaseInvestigationsOp } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { callOperation } from '../../api/client.ts';
import { DATABASE_INVESTIGATION_COPY as C } from '../../copy/databases.ts';
import { DatabaseInvestigationEvidence, readDatabaseInvestigation } from './database-investigation-evidence.tsx';

type Owner = { kind: 'assistant'; id: string } | { kind: 'task'; id: string; attemptId: string };

function useDatabaseInvestigation(
  owner: Owner | undefined,
  input: Record<string, unknown>,
  toolStartedAt: number,
  active: boolean,
) {
  const parsed = investigateDatabaseInputSchema.safeParse(input);
  const selection = parsed.success ? parsed.data : undefined;
  const enabled = active && owner !== undefined && selection !== undefined;
  const query = useQuery({
    queryKey: ['database-investigations', owner?.kind, owner?.id],
    queryFn: () => {
      if (owner === undefined) throw new Error('Database investigation owner missing');
      return callOperation(listDatabaseInvestigationsOp, { kind: owner.kind, id: owner.id });
    },
    enabled,
    refetchInterval: enabled ? 1000 : false,
  });
  if (!enabled || selection === undefined) return undefined;
  const matches = query.data?.items.filter((item) => {
    if (owner.kind === 'task' && item.attemptId !== owner.attemptId) return false;
    if (item.connection !== selection.connection || item.question !== selection.question) return false;
    return selection.investigation_id === undefined
      ? item.createdAt >= toolStartedAt
      : item.investigationId === selection.investigation_id && item.updatedAt >= toolStartedAt;
  });
  return matches?.length === 1 ? matches[0] : undefined;
}

export function DatabaseInvestigationPayload({
  owner,
  input,
  startedAt,
  active,
  output,
}: {
  owner: Owner | undefined;
  input: Record<string, unknown>;
  startedAt: number;
  active: boolean;
  output: string | undefined;
}) {
  const live = useDatabaseInvestigation(owner, input, startedAt, active);
  const investigation = readDatabaseInvestigation(output) ?? live;
  return investigation === undefined ? (
    <p className="hint">{active ? C.status.running : C.unavailable}</p>
  ) : (
    <DatabaseInvestigationEvidence investigation={investigation} />
  );
}
