import { COMPANION_WINDOW, type CompanionLayout, type CompanionPanel, type CompanionRect } from '@aw/shared';

const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, max)));

/** 角色允许部分移出屏幕，始终保留一块可拖回的区域。面板不参与角色的移动边界。 */
export function placeCompanion(actor: CompanionRect, area: CompanionRect, mode: CompanionPanel) {
  const visible = COMPANION_WINDOW.visible;
  const anchor = {
    ...actor,
    x: clamp(actor.x, area.x - actor.width + Math.min(visible, actor.width), area.x + area.width - visible),
    y: clamp(actor.y, area.y - actor.height + Math.min(visible, actor.height), area.y + area.height - visible),
  };
  const w = Math.min(COMPANION_WINDOW.width, area.width);
  const h = Math.min(mode === 'chat' ? COMPANION_WINDOW.height : COMPANION_WINDOW.bubbleHeight, area.height);
  const gap = COMPANION_WINDOW.margin;
  const centerX = clamp(anchor.x + (anchor.width - w) / 2, area.x, area.x + area.width - w);
  const centerY = clamp(anchor.y + (anchor.height - h) / 2, area.y, area.y + area.height - h);
  const candidates = [
    { side: 'above', x: centerX, y: anchor.y - gap - h },
    { side: 'below', x: centerX, y: anchor.y + anchor.height + gap },
    { side: 'right', x: anchor.x + anchor.width + gap, y: centerY },
    { side: 'left', x: anchor.x - gap - w, y: centerY },
  ] as const;
  const fits = (r: { x: number; y: number }) =>
    r.x >= area.x && r.y >= area.y && r.x + w <= area.x + area.width && r.y + h <= area.y + area.height;
  const chosen = candidates.find(fits) ?? candidates[0];
  // 极小工作区无法容纳相邻角色与完整面板时，面板留在屏幕内；角色位置仍不跳动。
  const panel =
    mode === 'none'
      ? null
      : {
          x: clamp(chosen.x, area.x, area.x + area.width - w),
          y: clamp(chosen.y, area.y, area.y + area.height - h),
          width: w,
          height: h,
        };
  // 留出光晕、呼吸和跳跃的绘制余量；它不参与拖动边界或面板定位。
  const bleed = Math.ceil(anchor.width / 4);
  const x = Math.max(area.x, Math.min(anchor.x - bleed, panel?.x ?? anchor.x));
  const y = Math.max(area.y, Math.min(anchor.y - bleed, panel?.y ?? anchor.y));
  const right = Math.min(
    area.x + area.width,
    Math.max(anchor.x + anchor.width + bleed, panel === null ? anchor.x : panel.x + w),
  );
  const bottom = Math.min(
    area.y + area.height,
    Math.max(anchor.y + anchor.height + bleed, panel === null ? anchor.y : panel.y + h),
  );
  const bounds = { x, y, width: Math.round(right - x), height: Math.round(bottom - y) };
  const local = (r: CompanionRect) => ({ ...r, x: r.x - x, y: r.y - y });
  const layout: CompanionLayout = {
    actor: local(anchor),
    panel: panel === null ? null : local(panel),
    side: chosen.side,
  };
  return { anchor, bounds, layout };
}
