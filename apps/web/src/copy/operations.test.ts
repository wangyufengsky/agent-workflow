import { assistantInputSchema, isAssistantCallable, OPERATION_CONTRACTS, OperationRisk } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { INPUT_FIELD_LABEL, OPERATION_TITLE } from './operations.ts';

describe('操作标题文案', () => {
  it('每个操作契约的 title 都有文案', () => {
    const missing = OPERATION_CONTRACTS.map((op) => op.title).filter((title) => OPERATION_TITLE[title] === undefined);
    expect(missing).toEqual([]);
  });

  it('助手确认卡片上的每个参数都有中文标签：指向对象的字段声明 refs，其余字段有字段文案', () => {
    const missing = OPERATION_CONTRACTS.filter((op) => isAssistantCallable(op) && op.risk !== OperationRisk.Read)
      .flatMap((op) => Object.keys(assistantInputSchema(op).shape).map((field) => [op, field] as const))
      .filter(([op, field]) => op.refs?.[field] === undefined && INPUT_FIELD_LABEL[field] === undefined)
      .map(([op, field]) => `${op.id}.${field}`);
    expect(missing).toEqual([]);
  });
});
