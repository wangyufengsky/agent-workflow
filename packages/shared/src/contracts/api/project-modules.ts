import { z } from 'zod';
import { ProjectModuleRunStatus } from '../../fsm/project-module-run.machine.ts';
import { functionalTestLaunchSchema } from './functional-testing.ts';

export const projectModuleConfigurationSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  scope: z.enum(['project', 'local']),
  mainClass: z.string(),
  javaVersion: z.number().int().optional(),
  directory: z.string(),
  includeProvided: z.boolean().optional(),
  review: z.array(z.string()),
  launch: functionalTestLaunchSchema.nullable(),
  fingerprint: z.string(),
});
export type ProjectModuleConfiguration = z.infer<typeof projectModuleConfigurationSchema>;
export const PROJECT_MODULE_CHECK_LIMIT = 64;

export const projectModuleCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  kind: z.enum(['maven-test', 'gradle-test', 'maven-junit', 'gradle-junit']),
  testClass: z.string().optional(),
});
export type ProjectModuleCheck = z.infer<typeof projectModuleCheckSchema>;
export const projectJavaModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
  kind: z.enum(['service', 'batch', 'library', 'unknown']),
  build: z.enum(['maven', 'gradle', 'standalone']),
  configurations: z.array(projectModuleConfigurationSchema),
  checks: z.array(projectModuleCheckSchema),
  evidence: z.array(z.string()),
  dependentModules: z.array(z.string()).optional(),
});
export type ProjectJavaModule = z.infer<typeof projectJavaModuleSchema>;
export const projectModuleRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  moduleId: z.string(),
  configurationId: z.string().nullable(),
  fingerprint: z.string(),
  baseline: z.string(),
  kind: z.enum(['launch', 'checks']),
  checkIds: z.array(z.string()),
  status: z.enum(ProjectModuleRunStatus),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  log: z.string(),
  readyUrl: z.string().nullable(),
  readyStatus: z.number().int().nullable(),
});
export type ProjectModuleRun = z.infer<typeof projectModuleRunSchema>;
export const projectModulesSchema = z.object({
  projectId: z.string(),
  branch: z.string(),
  baseline: z.string(),
  scannedAt: z.number(),
  modules: z.array(projectJavaModuleSchema),
  warnings: z.array(z.string()),
  defaults: z.record(z.string(), z.string()),
  runs: z.array(projectModuleRunSchema),
});
export type ProjectModules = z.infer<typeof projectModulesSchema>;

export function projectModuleVerified(run: ProjectModuleRun, configuration: ProjectModuleConfiguration) {
  return (
    run.kind === 'launch' &&
    run.configurationId === configuration.id &&
    run.fingerprint === configuration.fingerprint &&
    (run.status === 'ready' || run.status === 'stopped') &&
    run.readyStatus !== null &&
    run.readyStatus >= 200 &&
    run.readyStatus < 300
  );
}
