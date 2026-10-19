import { settingsOperations } from './settings.operations.ts';
import { createSettingsService, type SettingsServiceDeps } from './settings.service.ts';

export type { SettingsService } from './settings.service.ts';

export function createSettingsModule(deps: SettingsServiceDeps) {
  const service = createSettingsService(deps);
  return { service, operations: settingsOperations(service) };
}
