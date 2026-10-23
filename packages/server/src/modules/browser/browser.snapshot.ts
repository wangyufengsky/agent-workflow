import { z } from 'zod';

/** `Accessibility.getFullAXTree` nodes: output of the browser, parsed at the boundary (06 §1). */
const axValueSchema = z.object({ value: z.unknown().optional() }).optional();
export const axNodeSchema = z.object({
  nodeId: z.string(),
  ignored: z.boolean(),
  role: axValueSchema,
  name: axValueSchema,
  value: axValueSchema,
  properties: z.array(z.object({ name: z.string(), value: z.object({ value: z.unknown().optional() }) })).optional(),
  parentId: z.string().optional(),
  childIds: z.array(z.string()).optional(),
  backendDOMNodeId: z.number().optional(),
});
export type AxNode = z.infer<typeof axNodeSchema>;

/** The page as text (29 §5.6) and what each ref stands for (a backend DOM node id). */
export type Snapshot = { text: string; refs: Map<string, number> };

/** Elements the AI acts on; each gets a ref. */
const INTERACTIVE = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'treeitem',
  'listbox',
]);
/** Shown for the page's structure; every other role (generic, paragraph, label…) only passes its children on. */
const STRUCTURE = new Set([
  'heading',
  'main',
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'region',
  'form',
  'search',
  'dialog',
  'alertdialog',
  'alert',
  'status',
  'table',
  'row',
  'cell',
  'columnheader',
  'rowheader',
  'list',
  'listitem',
  'tablist',
  'tabpanel',
  'tree',
  'img',
  'figure',
  'article',
]);
/** Children counted as items of a list, a table or a listbox, cut when the page is long. */
const ITEMS = new Set(['row', 'listitem', 'option', 'treeitem']);
/** Text inside these is already their name; text inside a label is the name of its control. */
const TEXT_IN_NAME = new Set([...INTERACTIVE, 'heading', 'LabelText', 'caption', 'cell', 'columnheader', 'rowheader']);
const CELLS = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);
const VALUED = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);

const NAME_MAX = 100;
const TEXT_MAX = 200;
/** Items shown per list or table once the full page does not fit. */
const ITEMS_WHEN_LONG = 5;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const str = (v: { value?: unknown } | undefined) =>
  typeof v?.value === 'string' ? v.value.replace(/\s+/g, ' ').trim() : '';
const prop = (node: AxNode, name: string) => node.properties?.find((p) => p.name === name)?.value.value;

function attributes(node: AxNode, role: string): string {
  const parts: string[] = [];
  const level = prop(node, 'level');
  if (role === 'heading' && typeof level === 'number') parts.push(` [level=${level}]`);
  if (VALUED.has(role)) parts.push(` value="${clip(str(node.value), NAME_MAX)}"`);
  const checked = prop(node, 'checked');
  if (checked === 'true' || checked === 'mixed') parts.push(checked === 'true' ? ' checked' : ' mixed');
  if (prop(node, 'pressed') === 'true') parts.push(' pressed');
  if (prop(node, 'selected') === true) parts.push(' selected');
  if (prop(node, 'disabled') === true) parts.push(' disabled');
  return parts.join('');
}

function render(nodes: readonly AxNode[], itemsShown: number): Snapshot {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const lines: string[] = [];
  const refs = new Map<string, number>();
  const children = (node: AxNode) =>
    (node.childIds ?? []).flatMap((id) => {
      const child = byId.get(id);
      return child === undefined ? [] : [child];
    });
  const countOptions = (node: AxNode): number =>
    children(node).reduce((sum, c) => sum + (str(c.role) === 'option' ? 1 : countOptions(c)), 0);
  const hasInteractive = (node: AxNode): boolean =>
    children(node).some((c) => INTERACTIVE.has(str(c.role)) || hasInteractive(c));
  /** A row of plain cells reads as one line: `row "R-1001 · 张三 · ¥120.00"`. */
  const plainRow = (node: AxNode): string | null => {
    const cells = children(node);
    if (cells.length === 0 || !cells.every((c) => CELLS.has(str(c.role)) && !hasInteractive(c))) return null;
    return cells.map((c) => str(c.name)).join(' · ');
  };

  const walk = (node: AxNode, depth: number, textInName: boolean) => {
    const role = str(node.role);
    const indent = '  '.repeat(depth);
    if (role === 'InlineTextBox') return;
    if (role === 'StaticText') {
      const text = str(node.name);
      if (!node.ignored && !textInName && text !== '') lines.push(`${indent}"${clip(text, TEXT_MAX)}"`);
      return;
    }
    const row = role === 'row' && !node.ignored ? plainRow(node) : null;
    if (row !== null) {
      lines.push(`${indent}row "${clip(row, TEXT_MAX)}"`);
      return;
    }
    let inner = depth;
    let collapsed = false;
    if (!node.ignored && (INTERACTIVE.has(role) || STRUCTURE.has(role))) {
      const name = clip(str(node.name), NAME_MAX);
      let ref = '';
      if (INTERACTIVE.has(role) && node.backendDOMNodeId !== undefined) {
        const id = `e${refs.size + 1}`;
        refs.set(id, node.backendDOMNodeId);
        ref = ` [ref=${id}]`;
      }
      // A closed dropdown lists its options only once opened (29 §12 V6).
      collapsed = role === 'combobox' && prop(node, 'expanded') !== true;
      const options = collapsed ? ` (${countOptions(node)} 个选项)` : '';
      lines.push(`${indent}${role}${name === '' ? '' : ` "${name}"`}${attributes(node, role)}${ref}${options}`);
      inner = depth + 1;
    }
    if (collapsed) return;
    const kids = children(node);
    const items = kids.filter((c) => ITEMS.has(str(c.role))).length;
    let shown = 0;
    for (const child of kids) {
      if (ITEMS.has(str(child.role)) && ++shown > itemsShown) continue;
      walk(child, inner, textInName || TEXT_IN_NAME.has(role));
    }
    if (items > itemsShown) lines.push(`${'  '.repeat(inner)}…（共 ${items} 项，只显示前 ${itemsShown} 项）`);
  };
  const root = nodes.find((n) => n.parentId === undefined);
  if (root !== undefined) walk(root, 0, false);
  return { text: lines.join('\n'), refs };
}

/**
 * The accessibility tree as indented text (29 §5.6): structure and interactive elements with refs, page text as
 * quoted lines. Too long for `maxChars`, lists and tables keep their first items; still too long, the end is cut
 * with a note of what was left out.
 */
export function formatSnapshot(nodes: readonly AxNode[], maxChars: number): Snapshot {
  const full = render(nodes, Number.POSITIVE_INFINITY);
  if (full.text.length <= maxChars) return full;
  const short = render(nodes, ITEMS_WHEN_LONG);
  if (short.text.length <= maxChars) return short;
  const lines = short.text.split('\n');
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > maxChars - 40) break;
    kept.push(line);
    length += line.length + 1;
  }
  kept.push(`…（截断：省略了后面 ${lines.length - kept.length} 行）`);
  // Refs of cut lines stay valid: the elements still exist, the AI only did not see them.
  return { text: kept.join('\n'), refs: short.refs };
}
