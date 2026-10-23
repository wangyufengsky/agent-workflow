import { type RefObject, useEffect } from 'react';
import { useUiStore } from '../../state/ui.store.ts';

/** 原生视图盖在 DOM 上；全局浮层与模态框出现时隐藏，关联仍保留。 */
export function usePlacedPreview(tabId: string, area: RefObject<HTMLElement | null>) {
  const overlay = useUiStore((s) => s.paletteOpen || s.assistantOpen);
  useEffect(() => {
    const bridge = window.aw;
    const element = area.current;
    if (bridge === undefined || element === null) return;
    const place = () => {
      if (overlay || document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) {
        bridge.browser.place(tabId, null);
        return;
      }
      const rect = element.getBoundingClientRect();
      bridge.browser.place(tabId, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(element);
    const dialogs = new MutationObserver(place);
    dialogs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', place, true);
    return () => {
      dialogs.disconnect();
      resize.disconnect();
      window.removeEventListener('scroll', place, true);
      bridge.browser.place(tabId, null);
    };
  }, [tabId, area, overlay]);
}
