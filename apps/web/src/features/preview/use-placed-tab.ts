import { type RefObject, useEffect, useSyncExternalStore } from 'react';
import { useUiStore } from '../../state/ui.store.ts';

/** An open Radix dialog (the dialogs, drawers and the ⌘K palette all are one), or an alert dialog. */
const OPEN_DIALOG = '[role="dialog"][data-state="open"], [role="alertdialog"]';

function subscribeToDialogs(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { subtree: true, childList: true, attributeFilter: ['data-state'] });
  return () => observer.disconnect();
}
const dialogOpen = () => document.querySelector(OPEN_DIALOG) !== null;

/**
 * Whether something floats over the page: a dialog, a drawer, the ⌘K palette or the ⌘J assistant panel. A placed
 * tab is a native view drawn above the whole page, so it must leave the window meanwhile (29 §8.1).
 */
function useOverlayOpen(): boolean {
  const dialog = useSyncExternalStore(subscribeToDialogs, dialogOpen);
  const panels = useUiStore((s) => s.assistantOpen || s.paletteOpen);
  return dialog || panels;
}

/**
 * The part of `element` the user sees: native views are not clipped by the page's `overflow`, so the place is cut to
 * the window and to every scrolling ancestor; null when nothing of it shows.
 */
function visibleRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
  }
  const bounds = {
    x: Math.ceil(left),
    y: Math.ceil(top),
    width: Math.floor(right) - Math.ceil(left),
    height: Math.floor(bottom) - Math.ceil(top),
  };
  return bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

/**
 * Keeps the user's tab over the visible part of `area` while it is shown (29 §8.1, §8.6): its place follows layout
 * changes, scrolling and the window's size, and it leaves the window while an overlay is open, the area scrolled out
 * of sight or is gone.
 */
export function usePlacedTab(tabId: string | null, area: RefObject<HTMLDivElement | null>): void {
  const covered = useOverlayOpen();
  useEffect(() => {
    const bridge = window.aw;
    const element = area.current;
    if (tabId === null || bridge === undefined || element === null || covered) return;
    const place = () => bridge.browser.place(tabId, visibleRect(element));
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      bridge.browser.place(tabId, null);
    };
  }, [tabId, area, covered]);
}
