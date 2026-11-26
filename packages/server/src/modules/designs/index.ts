import type { Prompts } from '@aw/builtin';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { InboxService } from '../inbox/index.ts';
import type { ProjectsService } from '../projects/index.ts';
import type { SettingsService } from '../settings/index.ts';
import { createProjectKnowledgeReader } from './designs.knowledge.ts';
import { designsOperations } from './designs.operations.ts';
import { createDesignQueries } from './designs.queries.ts';
import type { createDesignsRepo } from './designs.repo.ts';
import { createDesignRuns } from './designs.runs.ts';
import { createDesignsService } from './designs.service.ts';
import { createDesignSubmissions } from './designs.submissions.ts';

export type { DesignsService } from './designs.service.ts';
export function createDesignsModule(deps: {
  repo: ReturnType<typeof createDesignsRepo>;
  clock: Clock;
  log: Logger;
  unit: UnitOfWork;
  attempts: AttemptsService;
  projects: ProjectsService;
  inbox: InboxService;
  settings: SettingsService;
  prompts: Prompts;
  assetsDir: string;
  copyFile: string;
}) {
  const runs = createDesignRuns(deps);
  const queries = createDesignQueries({ ...deps, runs });
  const service = createDesignsService({ ...deps, queries, runs });
  return {
    service,
    knowledge: createProjectKnowledgeReader(deps.repo),
    operations: designsOperations(service),
    submissions: createDesignSubmissions({ ...deps, incrementalFor: runs.incrementalFor }),
  };
}

export { renderProjectDesignContext } from './designs.context.ts';
export { designExclusion } from './designs.exclusions.ts';
export { exportDesignSite } from './designs.exporter.ts';
export { screenDesignImpact } from './designs.impact.ts';
export {
  buildProjectKnowledgeIndex,
  createProjectKnowledgeReader,
  type ProjectKnowledgeIndex,
} from './designs.knowledge.ts';
export { createReadyDesignKnowledgeReader } from './designs.queries.ts';
export {
  createDesignsRepo,
  type DesignDiagramRecord,
  type DesignFile,
  type DesignRun,
  type DesignSection,
  type ProjectDesign,
} from './designs.repo.ts';
export { createReviewKnowledgeReader, type ReviewKnowledgeSelection } from './designs.review-knowledge.ts';
export type { DesignSubmissions } from './designs.submissions.ts';
export { syncBuiltinDesignTemplates } from './designs.templates.ts';
