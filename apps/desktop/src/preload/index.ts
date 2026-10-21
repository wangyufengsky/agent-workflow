import type { AwBridge } from '@aw/shared';
import { contextBridge, ipcRenderer } from 'electron';

function arg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((a) => a.startsWith(prefix));
  if (value === undefined) throw new Error(`Missing preload argument ${name}`);
  return value.slice(prefix.length);
}

const bridge: AwBridge = {
  apiToken: arg('aw-api-token'),
  appVersion: arg('aw-app-version'),
  selectDirectory: () => ipcRenderer.invoke('aw:select-directory'),
  openExternal: (url) => ipcRenderer.invoke('aw:open-external', url),
  revealInFinder: (path) => ipcRenderer.invoke('aw:reveal-in-finder', path),
  exportPdf: (deckId, fileName) => ipcRenderer.invoke('aw:export-pdf', deckId, fileName),
  saveFile: (fileName, bytes) => ipcRenderer.invoke('aw:save-file', fileName, bytes),
  printSettled: (result) => ipcRenderer.send('aw:print-settled', result),
};

contextBridge.exposeInMainWorld('aw', bridge);
