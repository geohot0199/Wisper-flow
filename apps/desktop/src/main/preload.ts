/**
 * Preload — exposes a tiny, validated IPC surface to the renderer.
 *
 * Note: even with contextIsolation, the renderer is the most exposed
 * surface. We deliberately keep this surface small.
 */
// @ts-ignore — Electron types only present in the real build environment
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wisper', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  /**
   * The main process will validate this against an allowlist before
   * touching the store. Renderer can only set known keys, and each
   * value is type-checked.
   */
  setConfig: (partial: any) => ipcRenderer.invoke('config:set', partial),
  /**
   * Sandboxed — the main process will refuse inputs > 10 000 chars.
   */
  testRefine: (text: string) => ipcRenderer.invoke('refine:test', text),
  onState: (cb: (state: any) => void) => {
    const listener = (_: unknown, state: any) => cb(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
});
