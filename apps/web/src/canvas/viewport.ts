import type { CoordinateExtent, Viewport } from '@xyflow/react';
import type { Box } from './layout.ts';

/** Zoom range of every canvas; fitting stays within 0.5–1 (26 §2.2). */
export const ZOOM = { min: 0.3, max: 1.5, fitMin: 0.5, fitMax: 1 };
/** Below this zoom cards show only their title (26 §4.5). */
export const COMPACT_BELOW = 0.75;
const FIT_PADDING = 40;
/** Room the control bar takes at the bottom: the graph is centred above it. */
const CONTROLS_HEIGHT = 48;

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function boundsOf(boxes: Iterable<Box>): Bounds {
  const list = [...boxes];
  return {
    minX: Math.min(...list.map((b) => b.x)),
    minY: Math.min(...list.map((b) => b.y)),
    maxX: Math.max(...list.map((b) => b.x + b.width)),
    maxY: Math.max(...list.map((b) => b.y + b.height)),
  };
}

/**
 * The whole graph in view (26 §2.2): the largest zoom within 0.5–1 that fits; when even 0.5 does not fit the width,
 * the graph is left-aligned so the start is visible and the rest is panned to.
 */
export function fitViewport(b: Bounds, width: number, height: number): Viewport {
  const room = { width: width - FIT_PADDING * 2, height: height - FIT_PADDING * 2 - CONTROLS_HEIGHT };
  const fits = Math.min(room.width / (b.maxX - b.minX), room.height / (b.maxY - b.minY));
  const zoom = Math.min(ZOOM.fitMax, Math.max(ZOOM.fitMin, fits));
  const x =
    (b.maxX - b.minX) * zoom <= room.width ? width / 2 - ((b.minX + b.maxX) / 2) * zoom : FIT_PADDING - b.minX * zoom;
  return { x, y: (height - CONTROLS_HEIGHT) / 2 - ((b.minY + b.maxY) / 2) * zoom, zoom };
}

/**
 * Where panning may go (26 §2.3): the graph plus half the visible canvas on every side, so some of it always stays in
 * view. It depends on the zoom, which turns the canvas size into graph units.
 */
export function panExtent(b: Bounds, width: number, height: number, zoom: number): CoordinateExtent {
  const dx = width / 2 / zoom;
  const dy = height / 2 / zoom;
  return [
    [b.minX - dx, b.minY - dy],
    [b.maxX + dx, b.maxY + dy],
  ];
}

/** The viewport moved just enough to show `box` (zoom unchanged), or null when it is already in view. */
export function revealViewport(box: Box, view: Viewport, width: number, height: number): Viewport | null {
  const margin = 24;
  const left = view.x + box.x * view.zoom;
  const right = view.x + (box.x + box.width) * view.zoom;
  const top = view.y + box.y * view.zoom;
  const bottom = view.y + (box.y + box.height) * view.zoom;
  const dx = right > width - margin ? width - margin - right : left < margin ? margin - left : 0;
  const dy = bottom > height - margin ? height - margin - bottom : top < margin ? margin - top : 0;
  return dx === 0 && dy === 0 ? null : { ...view, x: view.x + dx, y: view.y + dy };
}
