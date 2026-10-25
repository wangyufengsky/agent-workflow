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
  // Stays with the user (D65): approving its own calls, the program the app starts, letting executors run any
  // command, where worktrees are written, which websites the AI opens and which servers get the user's system login;
  // whom the backend trusts and where its requests go (D164, D165). Once settings.update is always allowed, no card
  // would show for these.
  assistantOmit: [
    'assistant.alwaysAllow',
    'opencode.binaryPath',
    'ai.bashPolicy',
    'worktree.rootDir',
    'browser.sites',
    'browser.integratedAuthServers',
    'network.extraCaCerts',
    'network.proxy',
    'network.noProxy',
  ],
  mode: UiMode.Simple,
});
