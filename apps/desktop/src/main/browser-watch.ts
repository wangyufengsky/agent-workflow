import type { BrowserRect, BrowserWatchZoom } from '@aw/shared';
import type { WebContents } from 'electron';

type WatchMetrics = Record<string, unknown> & { width: number; height: number };
type Placement = { bounds: BrowserRect; displayScale: number };

export function isWatchMetrics(params: Record<string, unknown> | undefined): params is WatchMetrics {
  return (
    typeof params?.width === 'number' && params.width > 0 && typeof params.height === 'number' && params.height > 0
  );
}

export function createBrowserWatch(contents: WebContents, initial: WatchMetrics, placement: () => Placement | null) {
  let metrics = initial;
  let zoom: BrowserWatchZoom = 1;
  let x = 0;
  let y = 0;
  let applied = false;
  let queue = Promise.resolve();
  let scheduled = false;
  let scrollCheck: ReturnType<typeof setTimeout> | undefined;
  let pageX = 0;
  let pageY = 0;

  const send = (params: WatchMetrics) => contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', params);

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
    // 上一项失败由发起者处理，队列仍可以应用后续的视口更新。
    queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  const scaleAt = (bounds: BrowserRect) =>
    zoom === 'fit' ? Math.min(1, bounds.width / metrics.width, bounds.height / metrics.height) : zoom;

  async function readScroll(): Promise<boolean> {
    const { cssVisualViewport } = await contents.debugger.sendCommand('Page.getLayoutMetrics');
    const nextX = cssVisualViewport.pageX;
    const nextY = cssVisualViewport.pageY;
    const changed = nextX !== pageX || nextY !== pageY;
    pageX = nextX;
    pageY = nextY;
    return changed;
  }

  function followScroll(): void {
    // 固定的 CDP 裁切坐标相对文档。观看时跟随测试页自身滚动。
    clearTimeout(scrollCheck);
    scrollCheck = setTimeout(() => {
      scrollCheck = undefined;
      void serial(async () => {
        if (!applied || contents.isDestroyed() || !contents.debugger.isAttached()) return;
        if (await readScroll()) await apply(false, true);
        else followScroll();
      }).catch((err: unknown) => console.error('Browser watch scroll check failed', err));
    }, 200);
  }

  async function apply(refreshMetrics = false, scrollKnown = false): Promise<void> {
    clearTimeout(scrollCheck);
    scrollCheck = undefined;
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
    const position = placement();
    if (position === null || (zoom === 1 && x === 0 && y === 0)) {
      if (applied || refreshMetrics) await send(metrics);
      applied = false;
      return;
    }

    if (!scrollKnown) await readScroll();
    const { bounds, displayScale } = position;
    const scale = scaleAt(bounds);
    x = Math.max(0, Math.min(x, metrics.width - bounds.width / scale));
    y = Math.max(0, Math.min(y, metrics.height - bounds.height / scale));
    // viewport 是合成画面的裁切和缩放。保留原有设备指标与 Input.dispatchMouseEvent 的坐标。
    await send({
      ...metrics,
      viewport: {
        x: (pageX + x) * displayScale,
        y: (pageY + y) * displayScale,
        width: Math.max(1, Math.round((bounds.width * displayScale) / scale)),
        height: Math.max(1, Math.round((bounds.height * displayScale) / scale)),
        scale,
      },
    });
    applied = true;
    followScroll();
  }

  function refresh(): void {
    if (scheduled) return;
    scheduled = true;
    void serial(async () => {
      scheduled = false;
      await apply();
    }).catch((err: unknown) => console.error('Browser watch viewport update failed', err));
  }

  return {
    refresh,
    sync(): Promise<void> {
      return serial(() => apply());
    },
    changeMetrics(next: WatchMetrics): Promise<void> {
      return serial(async () => {
        if (metrics.width !== next.width || metrics.height !== next.height) x = y = 0;
        metrics = next;
        await apply(true);
      });
    },
    setZoom(next: BrowserWatchZoom): void {
      zoom = next;
      x = y = 0;
      refresh();
    },
    pan(dx: number, dy: number): void {
      const position = placement();
      if (position === null) return;
      const scale = scaleAt(position.bounds);
      x -= dx / scale;
      y -= dy / scale;
      refresh();
    },
    capture<T>(run: () => Promise<T>): Promise<T> {
      return serial(async () => {
        if (!applied) return run();
        await send(metrics);
        applied = false;
        try {
          return await run();
        } finally {
          await apply();
        }
      });
    },
  };
}
