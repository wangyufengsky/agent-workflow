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
      let left = Math.max(0, rect.left);
      let top = Math.max(0, rect.top);
      let right = Math.min(window.innerWidth, rect.right);
      let bottom = Math.min(window.innerHeight, rect.bottom);
      // 原生子视图不受 DOM 的 overflow 裁切，须主动限制在各滚动容器的可见交集内。
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
      bridge.browser.place(tabId, bounds.width > 0 && bounds.height > 0 ? bounds : null);
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(element);
    const dialogs = new MutationObserver(place);
    dialogs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      dialogs.disconnect();
      resize.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      bridge.browser.place(tabId, null);
    };
  }, [tabId, area, overlay]);
}
