import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { INITIATIVES_COPY as C } from '../../copy/initiatives.ts';
import { InitiativeCard } from './initiative-card.tsx';
import { initiativesQuery } from './initiatives.queries.ts';

/** Every initiative, newest first (34 §5.1). They start from the home page's「直接开始」panel. */
export function InitiativesPage() {
  const initiatives = useQuery(initiativesQuery());
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
      </div>
      {initiatives.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {initiatives.isError && <ErrorState error={initiatives.error} onRetry={() => void initiatives.refetch()} />}
      {initiatives.data?.length === 0 && <EmptyState icon="split" title={C.empty} body={C.emptyBody} />}
      <div className="grid-2">
        {initiatives.data?.map((i) => (
          <InitiativeCard key={i.id} initiative={i} />
        ))}
      </div>
    </div>
  );
}
