import { type RefObject, useEffect, useSyncExternalStore } from 'react';
import { useUiStore } from '../../state/ui.store.ts';

/** An open Radix dialog: the dialogs, drawers and the ⌘K palette all are one. */
const OPEN_DIALOG = '[role="dialog"][data-state="open"]';

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
  const assistant = useUiStore((s) => s.assistantOpen);
  return dialog || assistant;
}

/**
 * Keeps the user's tab over `area` while it is shown (29 §8.1, §8.6): its place follows layout changes and scrolling,
 * and it leaves the window while an overlay is open or the area is gone.
 */
export function usePlacedTab(tabId: string | null, area: RefObject<HTMLDivElement | null>): void {
  const covered = useOverlayOpen();
  useEffect(() => {
    const bridge = window.aw;
    const element = area.current;
    if (tabId === null || bridge === undefined || element === null || covered) return;
    const place = () => {
      const r = element.getBoundingClientRect();
      bridge.browser.place(tabId, {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      bridge.browser.place(tabId, null);
    };
  }, [tabId, area, covered]);
}
