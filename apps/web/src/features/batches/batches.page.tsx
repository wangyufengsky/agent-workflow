import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { EmptyState } from '../../components/empty-state.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { BATCHES_COPY as C } from '../../copy/batches.ts';
import { COMMON_COPY } from '../../copy/common.ts';
import { BatchCard } from './batch-card.tsx';
import { batchesQuery } from './batches.queries.ts';

/** Every batch, newest first (20 §4). */
export function BatchesPage() {
  const batches = useQuery(batchesQuery());
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1 className="title">{C.title}</h1>
          <p className="lede">{C.lede}</p>
        </div>
        <Link to={ROUTES.batchNew} className="btn primary">
          {C.create}
        </Link>
      </div>
      {batches.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {batches.isError && <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />}
      {batches.data?.length === 0 && <EmptyState icon="layers" title={C.empty} body={C.emptyBody} />}
      <div className="grid-2">
        {batches.data?.map((b) => (
          <BatchCard key={b.id} batch={b} />
        ))}
      </div>
    </div>
  );
}
