/**
 * Preload — exposes a tiny, typed IPC surface to the renderer.
 */
// @ts-ignore — Electron types only present in the real build environment
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wisper', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial: any) => ipcRenderer.invoke('config:set', partial),
  testRefine: (text: string) => ipcRenderer.invoke('refine:test', text),
  onState: (cb: (state: any) => void) => {
    const listener = (_: unknown, state: any) => cb(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
});
