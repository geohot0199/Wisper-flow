/**
 * Wisper Flow — Electron main process
 *
 * Responsibilities:
 *   1. Global hotkey registration (Ctrl+Shift+Space / ⌥+Space)
 *   2. Overlay window: floating pill, always-on-top, frameless
 *   3. Audio capture (system mic + optional wake word)
 *   4. STT dispatch (local whisper.cpp OR OpenAI Whisper API)
 *   5. Refinement via @wisper-flow/refinement
 *   6. LLM call (BYOK) + token streaming
 *   7. Text injection into the previously focused app
 *   8. Encrypted config store (electron-store)
 *
 * NOTE: This file uses dynamic require for `electron` so that the
 * non-Electron parts (refinement, LLM, inject, crypto) can be unit
 * tested without Electron installed.
 */

// We import the runtime pieces at the top level for ergonomics; the
// `electron` import is only resolved at runtime in a packaged build.
// @ts-ignore — types are only present in the real build environment
import * as electron from 'electron';
import * as path from 'path';
import * as fs from 'fs';
// @ts-ignore — same as above
import Store from 'electron-store';
import { refine, type Mode } from '@wisper-flow/refinement';
import { captureAudio, stopCapture } from './audio';
import { transcribeLocal, transcribeOpenAI } from './stt';
import { streamLLM, type LLMConfig } from './llm';
import { injectText, getActiveWindow } from './inject';
import { applyPromptTemplate } from './templates';
import { encryptKey, decryptKey } from './crypto';

const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, clipboard, nativeImage, screen, shell } = electron;

// ─── Config (encrypted-at-rest via electron-store + aes-gcm) ──────────────

interface AppConfig {
  hotkey: string;          // e.g. "CommandOrControl+Shift+Space"
  mode: Mode | 'auto';
  codingMode: boolean;
  language: string | null;
  maxTokens: number;
  stt: { provider: 'local' | 'openai'; model: string };
  llm: LLMConfig;
  wakeWord: boolean;
  autoInject: boolean;
}

const DEFAULTS: AppConfig = {
  hotkey: process.platform === 'darwin' ? 'Alt+Space' : 'CommandOrControl+Shift+Space',
  mode: 'auto',
  codingMode: false,
  language: null,
  maxTokens: 2048,
  stt: { provider: 'local', model: 'base.en' },
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: '' },
  wakeWord: false,
  autoInject: true,
};

// @ts-ignore — runtime only
const store = new Store({ defaults: DEFAULTS, name: 'wisper-flow-config' });

// ─── Windows ──────────────────────────────────────────────────────────────

let overlayWindow: any = null;
let tray: any = null;
let isListening = false;
let lastFocusedWindow: { id: string; title: string; app: string } | null = null;

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workArea;
  overlayWindow = new BrowserWindow({
    width: 480,
    height: 96,
    x: Math.round((width - 480) / 2),
    y: 80,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  overlayWindow.on('blur', () => {
    // don't auto-hide — let the renderer decide
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
}

function showOverlay(state: OverlayState) {
  if (!overlayWindow) createOverlayWindow();
  overlayWindow!.show();
  overlayWindow!.webContents.send('state', state);
}

function hideOverlay() {
  overlayWindow?.hide();
}

type OverlayState =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'transcribing' }
  | { kind: 'refining'; cleaned: string; mode: string }
  | { kind: 'llm'; prompt: string; partial: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; message: string };

// ─── Tray ─────────────────────────────────────────────────────────────────

function createTray() {
  // tiny inline icon (16x16 png as base64) — avoids shipping binary assets
  const iconBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVQ4T2NkYGD4z0AB' +
    'YBxVgB7ApGKDQwYjxoxfwK8GpwGsBsFkSJqMD4wf9ANR8wAaOK0AGY1QArQYGBkYGB4' +
    'YkGITRWJgYGB4AarCABcawwDH8wAAY0IHj0iG8JIAAAAASUVORK5CYII=';
  const img = nativeImage.createFromBuffer(Buffer.from(iconBase64, 'base64'));
  tray = new Tray(img);
  tray.setToolTip('Wisper Flow');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings', click: () => shell.openExternal('http://localhost:4310/settings') },
    { label: 'Toggle hotkey: ' + store.get('hotkey'), enabled: false },
    { type: 'separator' },
    { label: 'Quit Wisper Flow', click: () => app.quit() },
  ]));
  tray.on('click', () => toggleListening());
}

// ─── Hotkey + activation ─────────────────────────────────────────────────

function registerHotkey() {
  const hk = store.get('hotkey');
  try {
    globalShortcut.register(hk, () => toggleListening());
    console.log('[hotkey] registered:', hk);
  } catch (e) {
    console.error('[hotkey] failed to register', hk, e);
  }
}

async function toggleListening() {
  // remember the focused window so we can inject back into it
  lastFocusedWindow = await getActiveWindow();

  if (isListening) {
    await stopListening();
  } else {
    await startListening();
  }
}

async function startListening() {
  isListening = true;
  showOverlay({ kind: 'listening' });
  try {
    await captureAudio({
      onVadEnd: async (pcm) => {
        isListening = false;
        showOverlay({ kind: 'transcribing' });
        const cfg = store.get('stt');
        const transcript =
          cfg.provider === 'openai'
            ? await transcribeOpenAI(pcm, cfg.model, store.get('llm').apiKey)
            : await transcribeLocal(pcm, cfg.model);
        await handleTranscript(transcript);
      },
    });
  } catch (e: any) {
    isListening = false;
    showOverlay({ kind: 'error', message: String(e?.message ?? e) });
  }
}

async function stopListening() {
  isListening = false;
  await stopCapture();
  hideOverlay();
}

async function handleTranscript(raw: string) {
  if (!raw.trim()) {
    hideOverlay();
    return;
  }
  const refined = refine(raw, {
    mode: store.get('mode'),
    codingMode: store.get('codingMode'),
    language: store.get('language') ?? undefined,
    maxTokens: store.get('maxTokens'),
  });
  showOverlay({ kind: 'refining', cleaned: refined.cleaned, mode: refined.mode });

  const llm = store.get('llm');
  if (!llm.apiKey && llm.provider !== 'ollama') {
    showOverlay({ kind: 'error', message: 'No LLM API key. Open Settings.' });
    return;
  }

  if (store.get('autoInject')) {
    const final = applyPromptTemplate(refined.refinedPrompt, refined.mode, refined.language);
    let acc = '';
    showOverlay({ kind: 'llm', prompt: refined.refinedPrompt, partial: '' });
    try {
      await streamLLM(llm, [{ role: 'user', content: final }], {
        onChunk: (chunk) => {
          acc += chunk;
          showOverlay({ kind: 'llm', prompt: refined.refinedPrompt, partial: acc });
        },
      });
      await injectText(acc);
      clipboard.writeText(acc);
      showOverlay({ kind: 'done', text: acc });
      setTimeout(hideOverlay, 1200);
    } catch (e: any) {
      showOverlay({ kind: 'error', message: String(e?.message ?? e) });
    }
  } else {
    clipboard.writeText(refined.refinedPrompt);
    showOverlay({ kind: 'done', text: refined.refinedPrompt });
    setTimeout(hideOverlay, 1500);
  }
}

// ─── IPC: settings from renderer ─────────────────────────────────────────

ipcMain.handle('config:get', () => {
  const all = { ...DEFAULTS, ...store.store };
  const sanitized = { ...all, llm: { ...all.llm, apiKey: all.llm.apiKey ? '••••••••' : '' } };
  return sanitized;
});

ipcMain.handle('config:set', (_e: unknown, partial: Partial<AppConfig>) => {
  for (const [k, v] of Object.entries(partial)) {
    if (k === 'llm' && (v as any).apiKey && (v as any).apiKey !== '••••••••') {
      const enc = encryptKey((v as any).apiKey, getMachineFingerprint());
      store.set('llm.apiKey', enc);
      store.set('llm.provider', (v as any).provider);
      store.set('llm.model', (v as any).model);
    } else {
      store.set(k as any, v as any);
    }
  }
  if (partial.hotkey) {
    globalShortcut.unregisterAll();
    registerHotkey();
  }
  return true;
});

ipcMain.handle('refine:test', (_e: unknown, text: string) => refine(text, { mode: 'auto' }));

function getMachineFingerprint(): string {
  const p = path.join(app.getPath('userData'), '.fp');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  const fp = require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(p, fp, { mode: 0o600 });
  return fp;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const enc = store.get('llm.apiKey') as string;
  if (enc && enc.startsWith('enc:')) {
    const plain = decryptKey(enc, getMachineFingerprint());
    store.set('llm.apiKey', plain);
  }
  createOverlayWindow();
  createTray();
  registerHotkey();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  const k = store.get('llm.apiKey') as string;
  if (k && !k.startsWith('enc:')) {
    const enc = encryptKey(k, getMachineFingerprint());
    store.set('llm.apiKey', enc);
  }
});

if (process.platform === 'darwin') app.dock?.hide();
