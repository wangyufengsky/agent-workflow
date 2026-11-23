import { functionalTestApproveRevisionOp, functionalTestReadOp, functionalTestReportReadOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import { createFunctionalTests } from './functional-tests.service.ts';

export { ideaConfigurationReader, readIdeaConfigurations } from './functional-tests.idea.ts';
export { parseIdeaConfigurations, projectPath, visitIdeaXml } from './functional-tests.idea-xml.ts';

export type FunctionalTestsService = ReturnType<typeof createFunctionalTests>;

export function createFunctionalTestsModule(deps: Parameters<typeof createFunctionalTests>[0]) {
  const service = createFunctionalTests(deps);
  return {
    service,
    operations: [
      implement(functionalTestReadOp, ({ taskId, ...input }) => service.read(taskId, input)),
      implement(functionalTestReportReadOp, ({ taskId, runId, version }) => service.report(taskId, runId, version)),
      implement(functionalTestApproveRevisionOp, ({ taskId, proposal }) => service.approveRevision(taskId, proposal)),
    ],
  };
}
