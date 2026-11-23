import { z } from 'zod';
import {
  functionalTestCaseSchema,
  functionalTestReadSchema,
  functionalTestReportSchema,
  functionalTestSnapshotSchema,
} from '../contracts/api/functional-testing.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const common = {
  expose: { palette: false, assistant: true },
  credentialFields: [],
  refs: { taskId: InputRef.Task },
  mode: UiMode.Simple,
  risk: OperationRisk.Read,
} as const;
const taskId = z.string();

export const functionalTestReadOp = defineOperationContract({
  ...common,
  id: 'functionalTests.read',
  title: 'op.functionalTests.read',
  description: 'Read function test case versions, environments, executions and evidence for a task',
  input: functionalTestReadSchema.extend({ taskId }),
  output: functionalTestSnapshotSchema,
  http: { method: 'GET', path: '/tasks/:taskId/functional-test' },
});

export const functionalTestReportReadOp = defineOperationContract({
  ...common,
  id: 'functionalTests.report',
  title: 'op.functionalTests.report',
  description: 'Read the exact Markdown and outcomes of a published functional test report version',
  input: z.object({ taskId, runId: z.string().optional(), version: z.coerce.number().int().positive().optional() }),
  output: functionalTestReportSchema,
  http: { method: 'GET', path: '/tasks/:taskId/functional-test/report' },
});

export const functionalTestApproveRevisionOp = defineOperationContract({
  ...common,
  id: 'functionalTests.approveRevision',
  title: 'op.functionalTests.approveRevision',
  description: 'Approve the exact proposed changes to a test case at the specified event sequence',
  input: z.object({ taskId, proposal: z.coerce.number().int().positive() }),
  output: functionalTestCaseSchema,
  risk: OperationRisk.Write,
  http: { method: 'POST', path: '/tasks/:taskId/functional-test/revisions/:proposal/approve' },
});
