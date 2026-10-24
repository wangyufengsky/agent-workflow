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

  it('删除、取消、合并、推送类操作与跳过检查是 critical（D27、D108、D116）', () => {
    const critical = OPERATION_CONTRACTS.filter((op) => op.risk === OperationRisk.Critical).map((op) => op.id);
    expect(critical.sort()).toEqual(
      [
        'assistant.confirm',
        'assistant.delete',
        'assistant.replyPermission',
        'batches.deliver',
        'databases.delete',
        'decks.delete',
        'git.createPullRequest',
        'git.deleteBranch',
        'git.merge',
        'git.push',
        'inbox.resolve',
        'initiatives.delete',
        'initiatives.deliverPhase',
        'knowledge.delete',
        'projects.delete',
        'roles.delete',
        'schedules.delete',
        'tasks.cancel',
        'tasks.deliver',
        'tasks.skipCheck',
        'workflows.delete',
        'worktrees.prune',
      ].sort(),
    );
  });

  it('助手面板自己的操作不是助手工具：助手不能确认自己的调用（A-01）', () => {
    const own = OPERATION_CONTRACTS.filter((op) => op.id.startsWith('assistant.'));
    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((op) => op.expose.assistant || op.expose.palette)).toEqual([]);
  });

  it('操作 id 与 HTTP 路由各不相同', () => {
    const ids = OPERATION_CONTRACTS.map((op) => op.id);
    const routes = OPERATION_CONTRACTS.map((op) => `${op.http.method} ${op.http.path}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
