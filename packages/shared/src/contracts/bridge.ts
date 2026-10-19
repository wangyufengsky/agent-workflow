/** Capabilities the Electron preload exposes to the renderer as `window.aw`. */
export interface AwBridge {
  apiToken: string;
  appVersion: string;
  selectDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  revealInFinder(path: string): Promise<void>;
}
