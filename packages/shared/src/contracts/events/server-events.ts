import { z } from 'zod';
import { settingsSchema } from '../../constants/settings.ts';
import { ServerEventType } from '../../enums/system.ts';
import { runtimeSchema } from '../api/system.ts';

/** Domain events pushed over SSE (11 §11). Each milestone adds the events of the entities it introduces. */
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(ServerEventType.SettingsUpdated),
    data: z.object({ keys: z.array(settingsSchema.keyof()) }),
  }),
  z.object({ type: z.literal(ServerEventType.RuntimeUpdated), data: runtimeSchema }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
