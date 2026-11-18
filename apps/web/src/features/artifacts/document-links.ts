import { createContext } from 'react';
import { revealInPane } from '../../components/reveal-in-pane.ts';

/** 同一份 Markdown 在版本对照中可以出现两次，定位始终限制在点击所在的阅读框。 */
export function revealDocumentHeading(article: HTMLElement, fragment: string) {
  const pane = article.closest<HTMLElement>('section[aria-label]');
  if (!pane) return;
  const seen = new Set<string>();
  for (const heading of article.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
    const copy = heading.cloneNode(true) as HTMLElement;
    for (const control of copy.querySelectorAll('button,[data-kind]')) control.remove();
    const base = (copy.textContent ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '')
      .replace(/\s/g, '-');
    let slug = base;
    for (let n = 1; seen.has(slug); n++) slug = `${base}-${n}`;
    seen.add(slug);
    if (slug === fragment) {
      revealInPane(pane, heading);
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return;
    }
  }
}

export const DocumentNavigation = createContext<{
  paths: Set<string>;
  open: (path: string, fragment: string) => void;
  target?: { path: string; fragment: string } | undefined;
} | null>(null);

/** 只解析任务产物中的相对路径，外部链接继续由系统浏览器处理。 */
export function resolveDocumentLink(href: string, current: string, paths?: Set<string>) {
  if (!href || /^(?:[a-z][\w+.-]*:|[/\\])/i.test(href)) return;
  const hash = href.indexOf('#');
  try {
    const file = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
    const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
    if (!file) return { path: current, fragment };
    const parts = current.split('/').slice(0, -1);
    for (const part of file.split('/')) {
      if (part === '..') {
        if (!parts.length) return;
        parts.pop();
      } else if (part && part !== '.') parts.push(part);
    }
    const path = parts.join('/');
    if (path === current || paths?.has(path)) return { path, fragment };
  } catch {
    // 无效的百分号转义没有对应的文档锚点。
  }
}
