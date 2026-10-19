import { type CredentialsServiceDeps, createCredentialsService } from './credentials.service.ts';

export {
  type CipherTransport,
  type CredentialCipher,
  createPortCipher,
  parentPortTransport,
  unavailableCipher,
} from './cipher.ts';
export type { CredentialsService } from './credentials.service.ts';

export function createCredentialsModule(deps: CredentialsServiceDeps) {
  return { service: createCredentialsService(deps) };
}
