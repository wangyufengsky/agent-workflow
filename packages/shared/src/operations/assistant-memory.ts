import { z } from 'zod';
import {
  assistantMemoryContentSchema,
  assistantMemoryInputSchema,
  assistantMemorySchema,
} from '../contracts/api/assistant-memory.ts';
import { InputRef } from '../enums/entity.ts';
import { OperationRisk } from '../enums/system.ts';
import { UiMode } from '../enums/ui.ts';
import { defineOperationContract } from './define.ts';

const common = { expose: { palette: false, assistant: false }, credentialFields: [], mode: UiMode.Simple } as const;

export const listAssistantMemoriesOp = defineOperationContract({
  ...common,
  id: 'memory.list',
  title: 'op.memory.list',
  description: 'List personal and project memories for the memory manager',
  input: z.object({}),
  output: z.object({ items: z.array(assistantMemorySchema) }),
  risk: OperationRisk.Read,
  http: { method: 'GET', path: '/assistant/memories' },
});

export const createAssistantMemoryOp = defineOperationContract({
  ...common,
  id: 'memory.create',
  title: 'op.memory.create',
  description: 'Save an assistant memory with the user’s approval',
  input: assistantMemoryInputSchema,
  output: assistantMemorySchema,
  refs: { projectId: InputRef.Project },
  risk: OperationRisk.Critical,
  http: { method: 'POST', path: '/assistant/memories', status: 201 },
});

export const updateAssistantMemoryOp = defineOperationContract({
  ...common,
  id: 'memory.update',
  title: 'op.memory.update',
  description: 'Edit the content of an assistant memory',
  input: z.object({ id: z.string(), content: assistantMemoryContentSchema }),
  output: assistantMemorySchema,
  risk: OperationRisk.Write,
  http: { method: 'PATCH', path: '/assistant/memories/:id' },
});

export const deleteAssistantMemoryOp = defineOperationContract({
  ...common,
  id: 'memory.delete',
  title: 'op.memory.delete',
  description: 'Delete an assistant memory',
  input: z.object({ id: z.string() }),
  output: z.void(),
  risk: OperationRisk.Critical,
  http: { method: 'DELETE', path: '/assistant/memories/:id' },
});
