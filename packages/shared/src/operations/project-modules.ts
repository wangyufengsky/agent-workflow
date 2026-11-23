import { z } from 'zod';
import {
  PROJECT_MODULE_CHECK_LIMIT,
  projectModuleRunSchema,
  projectModulesSchema,
} from '../contracts/api/project-modules.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const id = z.string().min(1);
const project = z.object({ id });
const common = {
  mode: UiMode.Simple,
  refs: { id: InputRef.Project },
  credentialFields: [],
  expose: { palette: false, assistant: true },
} as const;
export const getProjectModulesOp = defineOperationContract({
  ...common,
  id: 'projects.modules',
  title: 'op.projects.modules',
  description:
    'Read Java modules, service and test configurations, source evidence, module defaults and recent runs for the project default branch',
  input: project,
  output: projectModulesSchema,
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:id/modules' },
});
export const rediscoverProjectModulesOp = defineOperationContract({
  ...common,
  id: 'projects.rediscoverModules',
  title: 'op.projects.rediscoverModules',
  description: 'Refresh Java module and IntelliJ IDEA configuration discovery for this project',
  input: project,
  output: projectModulesSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/modules/discover' },
});
export const defaultProjectModuleOp = defineOperationContract({
  ...common,
  id: 'projects.defaultModuleConfiguration',
  title: 'op.projects.defaultModuleConfiguration',
  description: 'Save a verified Java module configuration as the default selection for that module on this machine',
  input: project.extend({ moduleId: id, configurationId: id, fingerprint: id }),
  output: projectModulesSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/projects/:id/modules/default' },
});
export const startProjectModuleRunOp = defineOperationContract({
  ...common,
  id: 'projects.startModuleRun',
  title: 'op.projects.startModuleRun',
  description:
    'Start a module trial using its configuration ID and fingerprint, or run the selected check IDs from the project catalog in an isolated worktree',
  input: project.extend({
    moduleId: id,
    configurationId: id.optional(),
    fingerprint: id.optional(),
    checkIds: z.array(id).min(1).max(PROJECT_MODULE_CHECK_LIMIT).optional(),
    baseline: id,
  }),
  output: projectModuleRunSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/modules/run' },
});
export const stopProjectModuleRunOp = defineOperationContract({
  ...common,
  id: 'projects.stopModuleRun',
  title: 'op.projects.stopModuleRun',
  description: 'Stop the specified active module run and release its isolated worktree',
  input: project.extend({ runId: id }),
  output: projectModuleRunSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:id/modules/stop' },
});
