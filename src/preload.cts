import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopViewState } from './config.js';

const bridge: DesktopBridge = {
  config: () => ipcRenderer.invoke('dsh:config'),
  state: () => ipcRenderer.invoke('dsh:state'),
  connect: payload => ipcRenderer.invoke('dsh:connect', payload),
  stop: () => ipcRenderer.invoke('dsh:stop'),
  choose: payload => ipcRenderer.invoke('dsh:choose', payload),
  subscribe: listener => {
    const receive = (_event: Electron.IpcRendererEvent, state: DesktopViewState) => listener(state);
    ipcRenderer.on('dsh:state-update', receive);
    return () => ipcRenderer.removeListener('dsh:state-update', receive);
  },
};

contextBridge.exposeInMainWorld('dshDesktop', Object.freeze(bridge));
