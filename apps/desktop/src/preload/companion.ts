import type { CompanionBridge } from '@aw/shared';
import { ipcRenderer } from 'electron';

export const companionBridge: CompanionBridge = {
  surface: process.argv.includes('--aw-main-window')
    ? 'main'
    : process.argv.includes('--aw-companion-window')
      ? 'companion'
      : null,
  configure: (config, labels) => ipcRenderer.invoke('aw:companion-configure', config, labels),
  setInteractive: (value) => ipcRenderer.send('aw:companion-interactive', value),
  startDrag: (point) => ipcRenderer.send('aw:companion-drag-start', point),
  moveDrag: (point) => ipcRenderer.send('aw:companion-drag-move', point),
  endDrag: () => ipcRenderer.send('aw:companion-drag-end'),
  openMain: (path) => ipcRenderer.invoke('aw:companion-open', path),
  selectConversation: (id) => ipcRenderer.send('aw:companion-conversation', id),
  getConversation: () => ipcRenderer.invoke('aw:companion-conversation-get'),
  onConversation: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, id: string | null) => listener(id);
    ipcRenderer.on('aw:companion-conversation', receive);
    return () => {
      ipcRenderer.removeListener('aw:companion-conversation', receive);
    };
  },
  notify: (notice) => ipcRenderer.send('aw:companion-notice', notice),
  onNavigate: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, path: string) => listener(path);
    ipcRenderer.on('aw:companion-navigate', receive);
    return () => {
      ipcRenderer.removeListener('aw:companion-navigate', receive);
    };
  },
};
