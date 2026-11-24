import {
  CredentialKind,
  getOpencodeHeadersOp,
  getStartupEnvironmentOp,
  setOpencodeHeadersOp,
  setStartupEnvironmentOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import { createStartupEnvironmentService } from './startup-environment.service.ts';

export type { StartupEnvironmentService } from './startup-environment.service.ts';
export { startupEnvironmentTable } from './startup-environment.table.ts';

export function createStartupEnvironmentModule(deps: Parameters<typeof createStartupEnvironmentService>[0]) {
  const service = createStartupEnvironmentService(deps);
  const headers = createStartupEnvironmentService(deps, CredentialKind.OpencodeHeader);
  return {
    headers,
    service,
    operations: [
      implement(getOpencodeHeadersOp, headers.get),
      implement(setOpencodeHeadersOp, headers.set),
      implement(getStartupEnvironmentOp, service.get),
      implement(setStartupEnvironmentOp, service.set),
    ],
  };
}
