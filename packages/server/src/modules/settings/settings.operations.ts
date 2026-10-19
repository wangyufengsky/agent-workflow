import { getSettingsOp, updateSettingsOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { SettingsService } from './settings.service.ts';

export function settingsOperations(settings: SettingsService) {
  return [
    implement(getSettingsOp, () => settings.getAll()),
    implement(updateSettingsOp, (patch) => settings.update(patch)),
  ];
}
