import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown.tsx';

const html = (source: string, inline = false) => renderToStaticMarkup(<Markdown source={source} inline={inline} />);

describe('Markdown', () => {
  it('renders a step summary as headings, emphasis, inline code and code blocks', () => {
    const out = html('## 根因\n\n**原因**：`src/stats.ts:10` 未传比较函数。\n\n```ts\n[10, 9, 1].sort()\n```');
    expect(out).toContain('<h2>根因</h2>');
    expect(out).toContain('<strong>原因</strong>');
    expect(out).toContain('<code>src/stats.ts:10</code>');
    expect(out).toMatch(/<pre><code class="language-ts">\[10, 9, 1\]\.sort\(\)\n<\/code><\/pre>/);
  });

  it('shows raw HTML as text instead of running it', () => {
    const out = html('前<script>alert(1)</script><img src=x onerror="alert(2)">后');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('前&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('opens links in a new browser window and drops javascript: links', () => {
    expect(html('[文档](https://example.com)')).toContain(
      'href="https://example.com" target="_blank" rel="noreferrer"',
    );
    expect(html('[点我](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('inline keeps emphasis and code in one line and flattens blocks to their text', () => {
    const out = html('# 假设\n\n- 用 **UTC** 存 `created_at`', true);
    expect(out).toContain('<strong>UTC</strong>');
    expect(out).toContain('<code>created_at</code>');
    expect(out).not.toMatch(/<(h1|ul|li|p)\b/);
  });
});
