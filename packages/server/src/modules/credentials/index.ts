import { credentialsOperations } from './credentials.operations.ts';
import { type CredentialsServiceDeps, createCredentialsService } from './credentials.service.ts';

export {
  type CipherTransport,
  type CredentialCipher,
  createPortCipher,
  parentPortTransport,
  unavailableCipher,
} from './cipher.ts';
export type { CredentialsService } from './credentials.service.ts';
/** Exported for foreign keys only; reads and writes go through the service. */
export { credentialsTable } from './credentials.table.ts';

export function createCredentialsModule(deps: CredentialsServiceDeps) {
  const service = createCredentialsService(deps);
  return { service, operations: credentialsOperations(service) };
}
