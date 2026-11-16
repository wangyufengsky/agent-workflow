import { getProjectRuntimeCheckOp, startProjectRuntimeCheckOp, stopProjectRuntimeCheckOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { createProjectRuntimeService } from './projects.runtime-service.ts';

export function projectRuntimeOperations(service: ReturnType<typeof createProjectRuntimeService>) {
  return [
    implement(getProjectRuntimeCheckOp, ({ id }) => service.get(id)),
    implement(startProjectRuntimeCheckOp, (input) => service.start(input)),
    implement(stopProjectRuntimeCheckOp, ({ id }) => service.stop(id)),
  ];
}
