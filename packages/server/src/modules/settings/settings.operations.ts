import { getSettingsOp, updateSettingsOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { SettingsService, SettingsServiceDeps } from './settings.service.ts';

export function settingsOperations(settings: SettingsService, validateEffort: SettingsServiceDeps['validateEffort']) {
  return [
    implement(getSettingsOp, () => settings.getAll()),
    implement(updateSettingsOp, async (patch) => {
      const effort = patch['ai.defaultEffort'];
      if (effort)
        await validateEffort(effort, () =>
          patch['ai.defaultModel'] === undefined ? settings.get('ai.defaultModel') : patch['ai.defaultModel'],
        );
      return settings.update(patch);
    }),
  ];
}
