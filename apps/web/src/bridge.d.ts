import type { AwBridge } from '@aw/shared';

declare global {
  interface Window {
    /** Exposed by the Electron preload; absent when the renderer runs in a plain browser (dev / E2E). */
    aw?: AwBridge;
  }
}
