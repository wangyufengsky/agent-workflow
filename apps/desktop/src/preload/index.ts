import type { AwBridge, BrowserShortcut } from '@aw/shared';
import { contextBridge, ipcRenderer } from 'electron';
import { companionBridge } from './companion.ts';

function arg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((a) => a.startsWith(prefix));
  if (value === undefined) throw new Error(`Missing preload argument ${name}`);
  return value.slice(prefix.length);
}

const bridge: AwBridge = {
  companion: companionBridge,
  apiToken: arg('aw-api-token'),
  appVersion: arg('aw-app-version'),
  selectDirectory: () => ipcRenderer.invoke('aw:select-directory'),
  openExternal: (url) => ipcRenderer.invoke('aw:open-external', url),
  revealInFinder: (path) => ipcRenderer.invoke('aw:reveal-in-finder', path),
  exportPdf: (deckId, fileName) => ipcRenderer.invoke('aw:export-pdf', deckId, fileName),
  saveFile: (fileName, bytes) => ipcRenderer.invoke('aw:save-file', fileName, bytes),
  printSettled: (result) => ipcRenderer.send('aw:print-settled', result),
  setLaunchPreferences: (preferences) => ipcRenderer.send('aw:launch-preferences', preferences),
  browser: {
    onShortcut: (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, key: BrowserShortcut) => listener(key);
      ipcRenderer.on('aw:browser-shortcut', receive);
      return () => {
        ipcRenderer.removeListener('aw:browser-shortcut', receive);
      };
    },
    place: (tabId, rect) => ipcRenderer.send('aw:browser-place', tabId, rect),
    back: (tabId) => ipcRenderer.send('aw:browser-back', tabId),
    forward: (tabId) => ipcRenderer.send('aw:browser-forward', tabId),
    reload: (tabId) => ipcRenderer.send('aw:browser-reload', tabId),
    openDevTools: (tabId) => ipcRenderer.send('aw:browser-openDevTools', tabId),
  },
};

contextBridge.exposeInMainWorld('aw', bridge);
