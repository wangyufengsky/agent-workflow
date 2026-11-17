import { z } from 'zod';
import {
  browserCaseInputSchema,
  browserCaseRevisionSchema,
  browserCaseSchema,
} from '../contracts/api/browser-cases.ts';
import { taskDetailSchema } from '../contracts/api/tasks.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const project = z.object({ projectId: z.string() });
const revision = project.extend(browserCaseRevisionSchema.shape);
const permitted = z.object({ approved: z.literal(true) });
const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;

export const listBrowserCasesOp = defineOperationContract({
  ...common,
  id: 'browserCases.list',
  title: 'op.browserCases.list',
  description: 'List saved browser test cases in a project',
  input: project,
  output: z.object({ items: z.array(browserCaseSchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/projects/:projectId/browser-cases' },
});

export const createBrowserCaseOp = defineOperationContract({
  ...common,
  id: 'browserCases.create',
  title: 'op.browserCases.create',
  description: 'Save a browser test case in a project',
  input: project.extend({ definition: browserCaseInputSchema }),
  output: browserCaseSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:projectId/browser-cases', status: 201 },
});

export const updateBrowserCaseOp = defineOperationContract({
  ...common,
  id: 'browserCases.update',
  title: 'op.browserCases.update',
  description: 'Edit a saved browser test case at the specified revision',
  input: revision.extend({ definition: browserCaseInputSchema }),
  output: browserCaseSchema,
  risk: OperationRisk.Write,
  http: { method: 'PUT', path: '/projects/:projectId/browser-cases/:caseId' },
});

export const runBrowserCaseOp = defineOperationContract({
  ...common,
  id: 'browserCases.run',
  title: 'op.browserCases.run',
  description: 'Start a browser test task from the approved current case revision',
  input: revision.extend(permitted.shape),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/projects/:projectId/browser-cases/:caseId/run', status: 201 },
});

export const rerunBrowserCaseOp = defineOperationContract({
  ...common,
  id: 'browserCases.rerun',
  title: 'op.browserCases.rerun',
  description: 'Rerun the approved case snapshot from a previous task',
  input: permitted.extend({ id: z.string() }),
  output: taskDetailSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:id/browser-case/rerun', status: 201 },
});
