import { describe, expect, it } from 'vitest';
import { resolveAcceptance } from './nodes.rules.ts';

const withPreview = { checkCommand: 'pnpm test', previewPages: ['/', '/orders'] };
const noPreview = { checkCommand: 'pnpm test', previewPages: null };

describe('resolveAcceptance：页面体检（29 §7.1）', () => {
  it('没有写页面与视口时冻结项目的关键页面与桌面、手机两个视口', () => {
    const resolved = resolveAcceptance({ checks: [{ kind: 'browser' }], manual: false }, withPreview, false);
    expect(resolved.checks).toEqual([{ kind: 'browser', pages: ['/', '/orders'], viewports: ['desktop', 'mobile'] }]);
  });

  it('步骤写了页面与视口时用它自己的', () => {
    const resolved = resolveAcceptance(
      { checks: [{ kind: 'browser', pages: ['/refunds'], viewports: ['tablet'] }], manual: false },
      withPreview,
      false,
    );
    expect(resolved.checks).toEqual([{ kind: 'browser', pages: ['/refunds'], viewports: ['tablet'] }]);
  });

  it('项目没有页面预览时移除页面体检，其他检查照常', () => {
    const resolved = resolveAcceptance(
      {
        checks: [{ kind: 'command', command: '$PROJECT_CHECK' }, { kind: 'browser' }, { kind: 'ai_review' }],
        manual: false,
      },
      noPreview,
      false,
    );
    expect(resolved.checks).toEqual([{ kind: 'command', command: 'pnpm test' }, { kind: 'ai_review' }]);
  });
});
