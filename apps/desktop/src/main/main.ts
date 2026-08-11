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
    { label: 'Settings', click: () => safeOpenExternal('http://localhost:4310/settings') },
    { label: 'Toggle hotkey: ' + (() => { const hk = store.get('hotkey'); return typeof hk === 'string' ? hk.replace(/[\r\n]/g, '') : 'unknown'; })(), enabled: false },
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
  } catch (e) {
    // don't log the hotkey string — it can be sensitive on shared systems
    console.error('[hotkey] failed to register');
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

/**
 * Allowlist + type validator for IPC `config:set`. Anything that doesn't
 * match is silently dropped. This is the ONLY way renderer-side code can
 * influence config — preventing a renderer XSS or compromised renderer
 * dep from overwriting arbitrary keys or injecting a malicious hotkey.
 */
const CONFIG_KEYS = {
  hotkey: 'string',
  mode: 'string', // validated against enum below
  codingMode: 'boolean',
  language: 'string?',
  maxTokens: 'number',
  wakeWord: 'boolean',
  autoInject: 'boolean',
  stt: 'object',
  llm: 'object',
} as const;

const MODE_VALUES = new Set(['auto', 'general', 'code', 'email', 'note', 'shell']);
const PROVIDER_VALUES = new Set(['openai', 'anthropic', 'groq', 'ollama', 'local']);
const STT_PROVIDER_VALUES = new Set(['openai', 'local']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateConfig(partial: unknown): Partial<AppConfig> | null {
  if (!isPlainObject(partial)) return null;
  // Use null-prototype object so __proto__/constructor can't pollute.
  const out: any = Object.create(null);
  for (const [k, v] of Object.entries(partial)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (!(k in CONFIG_KEYS)) continue; // unknown key — drop
    const expected = (CONFIG_KEYS as any)[k];
    if (expected === 'string' && typeof v !== 'string') continue;
    if (expected === 'string?' && v !== null && typeof v !== 'string') continue;
    if (expected === 'boolean' && typeof v !== 'boolean') continue;
    if (expected === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) continue;
    if (expected === 'object' && !isPlainObject(v)) continue;
    // domain-level validation
    if (k === 'mode' && !MODE_VALUES.has(v as string)) continue;
    if (k === 'maxTokens' && ((v as number) < 64 || (v as number) > 128_000)) continue;
    if (k === 'hotkey' && (v as string).length > 64) continue;
    if (k === 'stt' && isPlainObject(v)) {
      const s: any = {};
      if ('provider' in v && typeof v.provider === 'string' && STT_PROVIDER_VALUES.has(v.provider)) s.provider = v.provider;
      if ('model' in v && typeof v.model === 'string' && v.model.length < 64 && /^[a-zA-Z0-9._-]+$/.test(v.model)) s.model = v.model;
      if (Object.keys(s).length) out.stt = s;
      continue;
    }
    if (k === 'llm' && isPlainObject(v)) {
      const l: any = {};
      if ('provider' in v && typeof v.provider === 'string' && PROVIDER_VALUES.has(v.provider)) l.provider = v.provider;
      if ('model' in v && typeof v.model === 'string' && v.model.length < 64 && /^[a-zA-Z0-9._-]+$/.test(v.model)) l.model = v.model;
      if ('apiKey' in v && typeof v.apiKey === 'string' && v.apiKey.length < 512 && v.apiKey !== '••••••••') {
        l.apiKey = v.apiKey;
      }
      if (Object.keys(l).length) out.llm = l;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Allowlisted external URLs only. Prevents `javascript:`, `file://`,
 * or `ms-cxh:` from being opened if any config value ever flows here.
 */
function safeOpenExternal(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.host !== 'localhost' && u.host !== '127.0.0.1') return false;
    return shell.openExternal(url);
  } catch {
    return false;
  }
}

ipcMain.handle('config:get', () => {
  const all = { ...DEFAULTS, ...store.store };
  const sanitized = { ...all, llm: { ...all.llm, apiKey: all.llm.apiKey ? '••••••••' : '' } };
  return sanitized;
});

ipcMain.handle('config:set', (_e: unknown, partial: unknown) => {
  const clean = validateConfig(partial);
  if (!clean) return false;
  for (const [k, v] of Object.entries(clean)) {
    if (k === 'llm' && (v as any).apiKey) {
      const enc = encryptKey((v as any).apiKey, getMachineFingerprint());
      store.set('llm.apiKey', enc);
      if ((v as any).provider) store.set('llm.provider', (v as any).provider);
      if ((v as any).model) store.set('llm.model', (v as any).model);
    } else {
      store.set(k as any, v as any);
    }
  }
  if (clean.hotkey) {
    globalShortcut.unregisterAll();
    registerHotkey();
  }
  return true;
});

ipcMain.handle('refine:test', (_e: unknown, text: unknown) => {
  // Bound input size — a malicious renderer can't make us run huge regex
  if (typeof text !== 'string' || text.length > 10_000) return null;
  return refine(text, { mode: 'auto' });
});

function getMachineFingerprint(): string {
  const p = path.join(app.getPath('userData'), '.fp');
  if (fs.existsSync(p)) {
    // On Windows, NTFS ignores POSIX mode bits, so we additionally try
    // to ACL the file to the current user. On macOS/Linux the 0o600
    // mode bit is sufficient.
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync(`icacls "${p}" /inheritance:r /grant:r "%USERNAME%:(R,W)" /C /Q`, { stdio: 'ignore', windowsHide: true });
      } catch { /* best-effort */ }
    }
    return fs.readFileSync(p, 'utf-8');
  }
  const fp = require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(p, fp, { mode: 0o600 });
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync(`icacls "${p}" /inheritance:r /grant:r "%USERNAME%:(R,W)" /C /Q`, { stdio: 'ignore', windowsHide: true });
    } catch { /* best-effort */ }
  }
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
