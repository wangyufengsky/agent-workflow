/**
 * Fitting never zooms out further than this: past it node titles are too small to read (12px titles at 0.8 are about
 * 10px); a larger graph is panned instead. Shared by the progress canvas and the plan editor.
 */
export const CANVAS_FIT = { padding: 0.15, minZoom: 0.8, maxZoom: 1 };

/**
 * Edge colours of the canvases (14 §5), from text tokens rather than `--edge`, which is too faint on the light themes'
 * sunken canvas: text tokens meet 4.5:1 on every theme (14 §4.1), so the lines read clearly in all four.
 */

/** Upstream step not finished yet. */
export const EDGE_PENDING = { stroke: 'var(--muted)', strokeWidth: 1.6, strokeDasharray: '6 5' };
/** Upstream step finished: solid, in the done tone. */
export const EDGE_DONE = { stroke: 'var(--ok)', strokeWidth: 2 };
/** A dependency in the plan editor, where steps have no progress. */
export const EDGE_PLAN = { stroke: 'var(--muted)', strokeWidth: 1.6 };
