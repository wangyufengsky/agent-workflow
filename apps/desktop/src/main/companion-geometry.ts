type Rect = { x: number; y: number; width: number; height: number };
/** 聊天窗整体留在可见工作区，小屏幕按工作区缩小。 */
export function fitCompanion(rect: Rect, area: Rect): Rect {
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  return {
    width,
    height,
    x: Math.round(Math.max(area.x, Math.min(rect.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(rect.y, area.y + area.height - height))),
  };
}
