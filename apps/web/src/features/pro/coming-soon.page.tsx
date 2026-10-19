import { EmptyState } from '../../components/empty-state.tsx';
import type { IconName } from '../../components/icon.tsx';
import { COMMON_COPY } from '../../copy/common.ts';

/** Pages whose milestone has not arrived yet (tasks M3, Git M4, workflows / roles / databases / tools M5, runtime M2). */
export function ComingSoonPage({ icon }: { icon: IconName }) {
  return (
    <div className="page">
      <EmptyState icon={icon} title={COMMON_COPY.comingSoonTitle} body={COMMON_COPY.comingSoonBody} />
    </div>
  );
}
