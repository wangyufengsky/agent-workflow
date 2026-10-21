import { z } from 'zod';
import { settingsPatchSchema, settingsSchema } from '../constants/settings.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

export const getSettingsOp = defineOperationContract({
  id: 'settings.get',
  title: 'op.settings.get',
  description: 'Read all user settings',
  input: z.object({}),
  output: settingsSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/settings' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  mode: UiMode.Simple,
});

export const updateSettingsOp = defineOperationContract({
  id: 'settings.update',
  title: 'op.settings.update',
  description: 'Change some user settings; returns all settings',
  input: settingsPatchSchema,
  output: settingsSchema,
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/settings' },
  expose: { palette: false, assistant: true },
  credentialFields: [],
  // Approving its own calls, or choosing the program the app starts, stays with the user (D65).
  assistantOmit: ['assistant.alwaysAllow', 'opencode.binaryPath'],
  mode: UiMode.Simple,
});
