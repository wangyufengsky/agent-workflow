/**
 * Markdown from the HTML that mammoth writes for a Word body (39 §5.2). mammoth's own Markdown writer drops tables,
 * and its HTML uses a small, well-formed set of tags, so a few dozen lines read it: headings, paragraphs, lists,
 * tables, emphasis, links and image placeholders. Anything else contributes its text.
 */

type Element = { tag: string; attrs: Record<string, string>; children: Node[] };
type Node = Element | string;

export type MarkdownCounts = { headings: number; tables: number; images: number };

const VOID = new Set(['br', 'img', 'hr']);
const TOKEN = /<(\/?)([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([a-zA-Z-]+)="([^"]*)"/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });

function parse(html: string): Node[] {
  const root: Element = { tag: 'root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  for (const [, closing, tag, attrText, selfClosing, text] of html.matchAll(TOKEN)) {
    const parent = stack[stack.length - 1] as Element;
    if (text !== undefined) {
      parent.children.push(decode(text));
    } else if (closing === '/') {
      // mammoth's HTML is well formed: the closing tag ends the innermost open element of that name.
      const at = stack.findLastIndex((element) => element.tag === tag);
      if (at > 0) stack.length = at;
    } else {
      const attrs = Object.fromEntries([...(attrText ?? '').matchAll(ATTR)].map(([, k, v]) => [k, decode(v ?? '')]));
      const element: Element = { tag: (tag as string).toLowerCase(), attrs, children: [] };
      parent.children.push(element);
      if (selfClosing !== '/' && !VOID.has(element.tag)) stack.push(element);
    }
  }
  return root.children;
}

export function htmlToMarkdown(html: string): { markdown: string; counts: MarkdownCounts } {
  const counts: MarkdownCounts = { headings: 0, tables: 0, images: 0 };

  function inline(nodes: readonly Node[]): string {
    return nodes
      .map((node) => {
        if (typeof node === 'string') return node.replace(/\s*\n\s*/g, ' ');
        const inner = inline(node.children);
        switch (node.tag) {
          case 'strong':
          case 'b':
            return inner.trim() === '' ? inner : `**${inner}**`;
          case 'em':
          case 'i':
            return inner.trim() === '' ? inner : `*${inner}*`;
          case 'a': {
            const href = node.attrs.href;
            // Bookmarks and footnote anchors only make noise.
            return href === undefined || href.startsWith('#') ? inner : `[${inner}](${href})`;
          }
          case 'img':
            counts.images += 1;
            return `[图片 ${counts.images}：${node.attrs.alt?.trim() || '无说明'}]`;
          case 'br':
            return '\n';
          default:
            return inner;
        }
      })
      .join('');
  }

  function list(element: Element, depth: number): string {
    const ordered = element.tag === 'ol';
    return element.children
      .filter((child): child is Element => typeof child !== 'string' && child.tag === 'li')
      .map((item, i) => {
        const nested = item.children.filter(
          (child): child is Element => typeof child !== 'string' && (child.tag === 'ul' || child.tag === 'ol'),
        );
        const own = item.children.filter((child) => !nested.includes(child as Element));
        const line = `${'  '.repeat(depth)}${ordered ? `${i + 1}.` : '-'} ${flow(own).trim()}`;
        return [line, ...nested.map((sub) => list(sub, depth + 1))].join('\n');
      })
      .join('\n');
  }

  /** A cell's paragraphs and lists on one line, as a GFM cell needs. */
  const cellText = (cell: Element) =>
    flow(cell.children)
      .replace(/\s*\n+\s*/g, ' ')
      .replaceAll('|', '\\|')
      .trim();

  function table(element: Element): string {
    counts.tables += 1;
    // Rows sit in the table itself or in its thead / tbody.
    const rows = element.children.flatMap((child) =>
      typeof child === 'string' ? [] : child.tag === 'tr' ? [child] : child.children.filter(isRow),
    );
    // Merged cells are repeated into every position they cover, so each row has all its columns (39 §5.2).
    const grid: string[][] = [];
    const pending: Array<{ text: string; rows: number } | undefined> = [];
    for (const row of rows) {
      const line: string[] = [];
      let column = 0;
      const fillPending = () => {
        for (let p = pending[column]; p !== undefined && p.rows > 0; p = pending[column]) {
          line.push(p.text);
          p.rows -= 1;
          column += 1;
        }
      };
      for (const cell of row.children) {
        if (typeof cell === 'string' || (cell.tag !== 'td' && cell.tag !== 'th')) continue;
        fillPending();
        const text = cellText(cell);
        const span = Number(cell.attrs.colspan ?? 1);
        const down = Number(cell.attrs.rowspan ?? 1);
        for (let s = 0; s < span; s++) {
          line.push(text);
          pending[column] = down > 1 ? { text, rows: down - 1 } : undefined;
          column += 1;
        }
      }
      fillPending();
      grid.push(line);
    }
    if (grid.length === 0) return '';
    const width = Math.max(...grid.map((line) => line.length));
    const padded = grid.map((line) => [...line, ...Array<string>(width - line.length).fill('')]);
    const render = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
    return [
      render(padded[0] as string[]),
      render(Array<string>(width).fill('---')),
      ...padded.slice(1).map(render),
    ].join('\n');
  }

  /** Block-level content: one Markdown block per paragraph, heading, list or table. */
  function flow(nodes: readonly Node[]): string {
    const blocks: string[] = [];
    let run: Node[] = [];
    const flush = () => {
      const text = inline(run).trim();
      if (text !== '') blocks.push(text);
      run = [];
    };
    for (const node of nodes) {
      if (typeof node === 'string' || !isBlock(node)) {
        run.push(node);
        continue;
      }
      flush();
      const heading = /^h([1-6])$/.exec(node.tag);
      if (heading !== null) {
        counts.headings += 1;
        blocks.push(`${'#'.repeat(Number(heading[1]))} ${inline(node.children).trim()}`);
      } else if (node.tag === 'ul' || node.tag === 'ol') {
        blocks.push(list(node, 0));
      } else if (node.tag === 'table') {
        blocks.push(table(node));
      } else {
        const text = flow(node.children);
        if (text !== '') blocks.push(text);
      }
    }
    flush();
    return blocks.join('\n\n');
  }

  return { markdown: flow(parse(html)), counts };
}

const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'div', 'li']);
const isBlock = (element: Element) => BLOCKS.has(element.tag);
const isRow = (node: Node): node is Element => typeof node !== 'string' && node.tag === 'tr';
