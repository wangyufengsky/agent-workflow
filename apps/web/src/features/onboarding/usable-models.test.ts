import type { ModelInfo } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { usableModels } from './usable-models.ts';

const model = (modelId: string, projectIds: string[]): ModelInfo => ({
  providerId: 'lan',
  modelId,
  name: modelId,
  contextLimit: null,
  projectIds,
});
const global = model('global', []);
const ofA = model('only-a', ['p-a']);
const ofAB = model('a-and-b', ['p-a', 'p-b']);

describe('usableModels（D162）', () => {
  it('项目里能选全局配置的模型和该项目自己配置的模型，别的项目的不能选', () => {
    expect(usableModels([global, ofA, ofAB], 'p-b').map((m) => m.modelId)).toEqual(['global', 'a-and-b']);
  });

  it('不属于任何项目（全局默认模型、角色模型、没选项目的 PPT）只能选全局配置的模型', () => {
    expect(usableModels([global, ofA, ofAB], null).map((m) => m.modelId)).toEqual(['global']);
  });
});
