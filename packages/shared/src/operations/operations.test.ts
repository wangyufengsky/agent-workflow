import { describe, expect, it } from 'vitest';
import { OperationRisk } from '../enums/system.ts';
import { OPERATION_CONTRACTS } from './index.ts';

/** Input field names that carry a secret (D28): they must never reach the assistant's tool schema. */
const SECRET_FIELD = /password|token|secret|credential/i;

describe('操作清单的标注（M5-10）', () => {
  it('输入中含凭据字段的操作都把它们声明为 credentialFields，且只声明这些字段', () => {
    const declared = OPERATION_CONTRACTS.map((op) => [op.id, [...op.credentialFields].sort()]);
    const secrets = OPERATION_CONTRACTS.map((op) => [
      op.id,
      Object.keys(op.input.shape)
        .filter((field) => SECRET_FIELD.test(field))
        .sort(),
    ]);
    expect(declared).toEqual(secrets);
  });

  it('删除、取消、合并类操作是 critical（D27）', () => {
    const critical = OPERATION_CONTRACTS.filter((op) => op.risk === OperationRisk.Critical).map((op) => op.id);
    expect(critical.sort()).toEqual(
      [
        'databases.delete',
        'inbox.resolve',
        'projects.delete',
        'roles.delete',
        'tasks.cancel',
        'tasks.deliver',
        'workflows.delete',
        'worktrees.prune',
      ].sort(),
    );
  });

  it('操作 id 与 HTTP 路由各不相同', () => {
    const ids = OPERATION_CONTRACTS.map((op) => op.id);
    const routes = OPERATION_CONTRACTS.map((op) => `${op.http.method} ${op.http.path}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
