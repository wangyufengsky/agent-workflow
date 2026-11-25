import type { ContextDetailDTO } from '@aw/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ContextContents } from './context-drawer.tsx';

it('原生助手显示账单与归档状态，受管模式显示摘要', () => {
  const detail: ContextDetailDTO = {
    reconstructed: false,
    budget: null,
    historyEstimate: 12,
    historyParts: { system: 41, tools: 59, dialogue: 12, toolOutput: 0, summary: 0, media: 0 },
    model: 'native',
    limit: 500,
    measuredInput: 100,
    cacheRead: 80,
    compactions: 1,
    compactionRequests: 1,
    managed: false,
    stopped: false,
    summary: null,
    folded: [],
    messages: [
      {
        id: 'm',
        role: 'user',
        title: 'hello',
        status: 'protected',
        sent: true,
        tokens: 2,
        projectedTokens: 2,
        preview: 'hello',
        length: 5,
        truncated: false,
      },
    ],
  };
  const native = renderToStaticMarkup(<ContextContents data={detail} />);
  expect(native).toContain('20%');
  expect(native).toContain('基础系统与工具定义估算');
  expect(native).toContain('<dd>41</dd>');
  expect(native).toContain('<dd>59</dd>');
  expect(native).toContain('原生压缩已完成 1 次');
  expect(native).not.toContain('后台语义摘要');
  const managed = renderToStaticMarkup(
    <ContextContents
      data={{
        ...detail,
        managed: true,
        summary: { summaryText: 'Published evidence', uptoMessageId: 'earlier-message', updatedAt: 0 },
      }}
    />,
  );
  expect(managed).toContain('Published evidence');
  expect(managed).toContain('earlier-message');
});
