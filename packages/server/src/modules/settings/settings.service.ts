import {
  SETTING_DEFAULTS,
  SETTING_KEYS,
  ServerEventType,
  type SettingKey,
  type Settings,
  type SettingsPatch,
  settingsSchema,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { EventBus } from '../../core/event-bus.ts';
import { createSettingsRepo } from './settings.repo.ts';

export type SettingsServiceDeps = {
  db: Db;
  events: EventBus;
  clock: Clock;
  /** Checks only the backend can make (a certificate parses, D164); throws VALIDATION_FAILED before anything is saved. */
  validate: (patch: SettingsPatch) => void;
};

export function createSettingsService({ db, events, clock, validate }: SettingsServiceDeps) {
  const repo = createSettingsRepo(db);

  function getAll(): Settings {
    // Stored JSON is a boundary: parse it with the same schema the API validates against.
    return settingsSchema.parse({ ...SETTING_DEFAULTS, ...repo.readAll() });
  }

  return {
    getAll,
    get<K extends SettingKey>(key: K): Settings[K] {
      return getAll()[key];
    },
    update(patch: SettingsPatch): Settings {
      validate(patch);
      const keys = SETTING_KEYS.filter((key) => patch[key] !== undefined);
      const now = clock.now();
      db.transaction((tx) => {
        const txRepo = createSettingsRepo(tx);
        for (const key of keys) txRepo.upsert(key, patch[key], now);
      });
      if (keys.length > 0) events.publish({ type: ServerEventType.SettingsUpdated, data: { keys } });
      return getAll();
    },
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;
