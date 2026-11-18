/** 按框在窗口中的实际位置预留底部空间，最后一行也能完全进入视口。 */
function fitReadingPane(pane: HTMLElement) {
  const top = Math.max(0, pane.getBoundingClientRect().top);
  pane.style.setProperty('--reader-available-height', `${Math.max(120, window.innerHeight - top - 12)}px`);
}

/** 用作阅读框的 React ref。用户调整窗口、滚动外层任务页时重新计算可用高度。 */
export function sizeReadingPane(pane: HTMLElement | null) {
  if (!pane) return;
  const resize = () => fitReadingPane(pane);
  const onScroll = (e: Event) => {
    if (e.target instanceof Node && e.target !== pane && e.target.contains(pane)) resize();
  };
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', onScroll, true);
  return () => {
    window.removeEventListener('resize', resize);
    window.removeEventListener('scroll', onScroll, true);
  };
}

/** 将目标移入阅读框可见区域。表格可能还有自己的滚动条，任务页的滚动位置由用户控制。 */
export function revealInPane(pane: HTMLElement, target: Element) {
  if (!pane.contains(target) || !pane.clientHeight) return;
  fitReadingPane(pane);
  for (let box = target.parentElement; box && pane.contains(box); box = box.parentElement) {
    const style = getComputedStyle(box);
    const bounds = box.getBoundingClientRect();
    const row = target.getBoundingClientRect();
    if (/auto|scroll/.test(style.overflowY) && box.scrollHeight > box.clientHeight) {
      const top = Math.max(0, bounds.top + box.clientTop);
      const bottom = Math.min(window.innerHeight, bounds.top + box.clientTop + box.clientHeight);
      if (bottom > top && (row.top < top || row.bottom > bottom))
        box.scrollTop += row.top - top - Math.max(0, (bottom - top - row.height) / 2);
    }
    if (/auto|scroll/.test(style.overflowX) && box.scrollWidth > box.clientWidth) {
      const left = bounds.left + box.clientLeft;
      if (row.left < left) box.scrollLeft += row.left - left;
      else if (row.right > left + box.clientWidth) box.scrollLeft += row.right - left - box.clientWidth;
    }
    if (box === pane) break;
  }
}
