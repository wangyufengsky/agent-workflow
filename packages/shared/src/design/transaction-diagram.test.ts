import { expect, it } from 'vitest';
import type { DesignTransaction } from '../contracts/design/block.ts';
import type { DesignDiagramEdge } from '../contracts/design/diagram.ts';
import { presentTransactionDiagram } from './transaction-diagram.ts';

function evidence(relPath: string) {
  return { relPath, lineStart: 1, lineEnd: 1, evidenceClass: 'static' as const };
}
const transaction: DesignTransaction = {
  type: 'transaction',
  title: '凭证签发',
  diagramId: 'issuance',
  evidence: [evidence('route.ts')],
};
function edge(from: string, to: string, kind = 'call'): DesignDiagramEdge {
  return { id: `${from}-${to}`, from, to, kind, evidenceClass: 'inferred', rationale: '按注册关系推断。' };
}

it('业务动作、旧报告中的表达式和未绑定的步骤使用各自的原文与出处', () => {
  const result = presentTransactionDiagram(
    [
      { id: 'read', label: '读取签发策略', targetKind: 'symbol', targetId: 'policy' },
      {
        id: 'key',
        label: 'keyring.lookup(request.key)',
        summary: '按凭证标识取得签名密钥；找不到时拒绝请求。',
        relPath: 'keys.ts',
      },
      {
        id: 'issue',
        label: '发送签发请求',
        summary: '使用 `signer.issue` 向第三方发起签发。',
        group: '外部边界',
        relPath: 'channel.ts',
      },
      { id: 'deny', label: '拒绝签发', group: '异常出口' },
      { id: 'finish', label: '完成签发' },
    ],
    [
      edge('read', 'key'),
      { ...edge('key', 'issue'), evidencePath: 'bridge.ts' },
      edge('key', 'deny', 'throw'),
      edge('issue', 'finish'),
    ],
    [
      { id: 'f1', relPath: 'policy.ts', symbols: [{ id: 'policy', qualifiedName: 'Policy.read', name: 'readPolicy' }] },
      { id: 'f2', relPath: 'unrelated.ts', symbols: [] },
    ],
    {
      ...transaction,
      fields: [
        {
          name: 'principal',
          description: '外部身份映射',
          steps: ['read'],
          evidence: [evidence('keys.ts'), evidence('identity.ts')],
        },
      ],
    },
  );
  expect(result.nodes).toEqual([
    {
      id: 'read',
      title: '读取签发策略',
      detail: 'readPolicy',
      role: 'step',
      source: { fileId: 'f1', path: 'policy.ts', symbolId: 'policy' },
    },
    { id: 'key', title: '按凭证标识取得签名密钥', detail: 'keyring.lookup(request.key)', role: 'step', source: null },
    { id: 'issue', title: '发送签发请求', detail: 'signer.issue', role: 'external', source: null },
    { id: 'deny', title: '拒绝签发', detail: '异常出口', role: 'exception', source: null },
    { id: 'finish', title: '完成签发', detail: '', role: 'step', source: null },
  ]);
  expect(result.edges.map(({ role }) => role)).toEqual(['normal', 'normal', 'exception', 'normal']);
  expect(result.sourcePaths).toEqual(['route.ts', 'policy.ts', 'keys.ts', 'channel.ts', 'bridge.ts', 'identity.ts']);
});

it('跨交易重名符号只在有文件依据时定位，推断与静态证据沿用边的业务含义', () => {
  const symbol = { id: 'save', qualifiedName: 'Ledger.save', name: 'save' };
  const files = ['orders', 'refunds'].map((id) => ({ id, relPath: `${id}.ts`, symbols: [symbol] }));
  const unbound = { id: 'lookup', targetKind: 'symbol' as const, targetId: 'Ledger.save', label: '保存请求' };
  const bound = { ...unbound, id: 'write', relPath: 'refunds.ts' };
  const rejected = edge('lookup', 'write', 'reject');
  const result = presentTransactionDiagram(
    [unbound, bound],
    [
      rejected,
      { ...rejected, id: 'static', evidenceClass: 'static', evidencePath: 'refunds.ts', lineStart: 1, lineEnd: 1 },
    ],
    files,
    transaction,
  );
  expect(result.nodes.map(({ source }) => source)).toEqual([
    null,
    { fileId: 'refunds', path: 'refunds.ts', symbolId: 'save' },
  ]);
  expect(result.sourcePaths).toEqual(['route.ts', 'refunds.ts']);
  expect(result.edges.map(({ role }) => role)).toEqual(['exception', 'exception']);
});

it('长交易纵向阅读，分支、回边和自循环均可见，节点与画布边界互不遮挡', () => {
  const chain = Array.from({ length: 20 }, (_, n) => ({ id: String(n), label: `核对凭证 ${n}` }));
  const edges = chain.slice(1).map((node, i) => edge(String(i), node.id));
  const graph = presentTransactionDiagram(
    [...chain, { id: 'denied', label: '签名无效' }],
    [...edges, edge('7', 'denied', 'reject'), edge('19', '0', 'return'), edge('7', '7', 'retry')],
    [],
    transaction,
  ).layout;
  expect(graph.height).toBeGreaterThan(graph.width);
  expect(graph.placed).toHaveLength(21);
  expect(graph.routes.filter(({ back }) => back).map(({ id }) => id)).toEqual(['19-0', '7-7']);
  for (const [i, { box }] of graph.placed.entries()) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(graph.width);
    expect(box.y + box.height).toBeLessThanOrEqual(graph.height);
    for (const { box: other } of graph.placed.slice(i + 1))
      expect(
        box.x + box.width <= other.x ||
          other.x + other.width <= box.x ||
          box.y + box.height <= other.y ||
          other.y + other.height <= box.y,
      ).toBe(true);
  }
  for (const route of graph.routes) {
    expect(route.labelX).toBeGreaterThanOrEqual(0);
    expect(route.labelX).toBeLessThan(graph.width);
    expect(route.labelY).toBeGreaterThanOrEqual(0);
    expect(route.labelY).toBeLessThan(graph.height);
    expect(route.labelWidth).toBeGreaterThan(0);
  }
});

it('同一对节点的成功与异常分支各自保留可选的路径和条件标签位置', () => {
  const steps = [
    { id: 'dispatch', label: '派发' },
    { id: 'settle', label: '终结' },
  ];
  const ok = edge('dispatch', 'settle', 'return');
  const rejected = { ...ok, id: 'failed', kind: 'reject' };
  const { layout } = presentTransactionDiagram(steps, [ok, rejected], [], transaction);
  expect(new Set(layout.routes.map((route) => route.path)).size).toBe(2);
  expect(new Set(layout.routes.map((route) => route.labelY)).size).toBe(2);
});

it('交叉分支的条件和并行回边标签均能读到', () => {
  const ids = ['start', 'a', 'b', 'c', 'd', 'finish'];
  const back = edge('finish', 'start', 'retry');
  const routes = presentTransactionDiagram(
    ids.map((id) => ({ id, label: id })),
    [
      edge('start', 'a'),
      edge('start', 'b'),
      edge('a', 'c'),
      edge('a', 'd'),
      edge('b', 'c'),
      edge('b', 'd'),
      edge('c', 'finish'),
      edge('d', 'finish'),
      back,
      { ...back, id: 'reopen' },
    ],
    [],
    transaction,
  ).layout.routes;
  for (const [i, route] of routes.entries()) {
    for (const other of routes.slice(i + 1)) {
      expect(
        Math.abs(route.labelY - other.labelY) >= 20 ||
          Math.abs(route.labelX - other.labelX) >= (route.labelWidth + other.labelWidth) / 2,
      ).toBe(true);
    }
  }
});
