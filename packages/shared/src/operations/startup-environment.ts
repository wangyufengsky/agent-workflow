import { z } from 'zod';
import {
  opencodeHeadersInputSchema,
  startupEnvironmentInputSchema,
  startupEnvironmentSchema,
} from '../contracts/api/startup-environment.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const common = {
  refs: {},
  output: startupEnvironmentSchema,
  expose: { palette: false, assistant: false },
  credentialFields: [],
  mode: UiMode.Pro,
} as const;

export const getStartupEnvironmentOp = defineOperationContract({
  ...common,
  id: 'settings.getStartupEnvironment',
  title: 'op.settings.getStartupEnvironment',
  description: 'Read the configured startup environment without revealing secret values',
  input: z.object({}),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/settings/startup-environment' },
});
export const setStartupEnvironmentOp = defineOperationContract({
  ...common,
  id: 'settings.setStartupEnvironment',
  title: 'op.settings.setStartupEnvironment',
  description: 'Replace the startup environment; omit an existing secret value to keep it',
  input: startupEnvironmentInputSchema,
  credentialFields: ['items'],
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/settings/startup-environment' },
});

export const getOpencodeHeadersOp = defineOperationContract({
  ...common,
  id: 'settings.getOpencodeHeaders',
  title: 'op.settings.getOpencodeHeaders',
  description: 'Read the configured model request headers without revealing secret values',
  input: z.object({}),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/settings/opencode-headers' },
});
export const setOpencodeHeadersOp = defineOperationContract({
  ...common,
  id: 'settings.setOpencodeHeaders',
  title: 'op.settings.setOpencodeHeaders',
  description: 'Replace the custom headers for model requests made by OpenCode',
  input: opencodeHeadersInputSchema,
  credentialFields: ['items'],
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/settings/opencode-headers' },
});
