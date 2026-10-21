import type { BatchSummaryDTO } from '@aw/shared';
import { Link } from '@tanstack/react-router';
import { ROUTES } from '../../app/routes.ts';
import { BATCHES_COPY as C } from '../../copy/batches.ts';
import { BatchProgress } from './batch-progress.tsx';
import { TemplateText } from './template-text.tsx';

/** A batch in a list: title, workflow and project, and its progress. */
export function BatchCard({ batch }: { batch: BatchSummaryDTO }) {
  return (
    <Link to={ROUTES.batch} params={{ batchId: batch.id }} className="card pad col" data-testid="batch-card">
      <span className="section-title ellipsis">
        <span className="mono">{batch.key}</span> · <TemplateText text={batch.title} />
      </span>
      <span className="hint ellipsis">{C.meta(batch.workflow.name, batch.project.name)}</span>
      <BatchProgress batch={batch} />
    </Link>
  );
}
