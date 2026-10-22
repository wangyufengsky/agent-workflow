/**
 * A streamed text or reasoning line (10 §3, D104): `text` replaces the part's text from character `offset` on.
 * Lines written before D104 hold the whole text with `offset` 0.
 */
export type TextPiece = { text: string; offset: number };

/** The piece that `a` followed by `b` amounts to; applying it equals applying `a`, then `b`. */
export function mergePiece(a: TextPiece, b: TextPiece): TextPiece {
  if (b.offset < a.offset) return b;
  return { offset: a.offset, text: a.text.slice(0, b.offset - a.offset) + b.text };
}

/** The piece that turns `before` into `after`: what changed after their common prefix. */
export function pieceBetween(before: string, after: string): TextPiece {
  let at = 0;
  if (after.startsWith(before)) at = before.length;
  else while (at < before.length && at < after.length && before[at] === after[at]) at++;
  return { offset: at, text: after.slice(at) };
}
