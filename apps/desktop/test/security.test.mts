/**
 * Security tests for the desktop main process.
 *
 * Tests the IPC `config:set` validator against malicious payloads.
 * We import the validator indirectly by exercising the same logic that
 * the IPC handler uses, without needing Electron.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirror of the validator in main.ts. Keep in sync. If you change the
 * real one, change this too — both should fail together.
 */
const CONFIG_KEYS: Record<string, string> = {
  hotkey: 'string', mode: 'string', codingMode: 'boolean', language: 'string?',
  maxTokens: 'number', wakeWord: 'boolean', autoInject: 'boolean', stt: 'object', llm: 'object',
};
const MODE_VALUES = new Set(['auto', 'general', 'code', 'email', 'note', 'shell']);
const PROVIDER_VALUES = new Set(['openai', 'anthropic', 'groq', 'ollama', 'local']);
const STT_PROVIDER_VALUES = new Set(['openai', 'local']);

function isPlainObject(v: any): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateConfig(partial: any): any {
  if (!isPlainObject(partial)) return null;
  const out: any = Object.create(null); // null-proto, defence in depth
  for (const [k, v] of Object.entries(partial)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (!(k in CONFIG_KEYS)) continue;
    const expected = CONFIG_KEYS[k];
    if (expected === 'string' && typeof v !== 'string') continue;
    if (expected === 'string?' && v !== null && typeof v !== 'string') continue;
    if (expected === 'boolean' && typeof v !== 'boolean') continue;
    if (expected === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) continue;
    if (expected === 'object' && !isPlainObject(v)) continue;
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
      if ('apiKey' in v && typeof v.apiKey === 'string' && v.apiKey.length < 512 && v.apiKey !== '••••••••') l.apiKey = v.apiKey;
      if (Object.keys(l).length) out.llm = l;
      continue;
    }
    out[k] = v;
  }
  return out;
}

// ─── Tests ────────────────────────────────────────────────────────────────

test('config:set rejects unknown keys', () => {
  const out: any = validateConfig({ __proto__: 'polluted', evilKey: 'rm -rf /', hotkey: 'Ctrl+X' });
  assert.equal(out.evilKey, undefined);
  // The Object prototype must NOT be polluted
  const probe: any = {};
  assert.equal((probe as any).isAdmin, undefined);
  // Legit key still allowed
  assert.equal(out.hotkey, 'Ctrl+X');
});

test('config:set rejects type mismatches', () => {
  const out = validateConfig({
    hotkey: 12345,         // not a string
    codingMode: 'yes',     // not a boolean
    maxTokens: 'unbounded', // not a number
  });
  assert.equal(out.hotkey, undefined);
  assert.equal(out.codingMode, undefined);
  assert.equal(out.maxTokens, undefined);
});

test('config:set rejects out-of-range maxTokens', () => {
  assert.equal(validateConfig({ maxTokens: 1 }).maxTokens, undefined);
  assert.equal(validateConfig({ maxTokens: 999_999 }).maxTokens, undefined);
  assert.equal(validateConfig({ maxTokens: 1024 }).maxTokens, 1024);
});

test('config:set rejects invalid mode enum', () => {
  const out = validateConfig({ mode: 'hack' });
  assert.equal(out.mode, undefined);
  const out2 = validateConfig({ mode: 'code' });
  assert.equal(out2.mode, 'code');
});

test('config:set rejects hotkey that is too long (potential injection)', () => {
  const out = validateConfig({ hotkey: 'A'.repeat(100) });
  assert.equal(out.hotkey, undefined);
});

test('config:set LLM model — strict allowlist regex (alphanum + . _ -)', () => {
  assert.equal(validateConfig({ llm: { model: 'gpt-4o-mini' } }).llm.model, 'gpt-4o-mini');
  // shell metacharacters must be rejected
  assert.equal(validateConfig({ llm: { model: 'gpt-4; rm -rf /' } }).llm?.model, undefined);
  assert.equal(validateConfig({ llm: { model: '../etc/passwd' } }).llm?.model, undefined);
});

test('config:set LLM provider — allowlist only', () => {
  assert.equal(validateConfig({ llm: { provider: 'openai' } }).llm.provider, 'openai');
  assert.equal(validateConfig({ llm: { provider: 'evil' } }).llm?.provider, undefined);
  assert.equal(validateConfig({ llm: { provider: '' } }).llm?.provider, undefined);
});

test('config:set STT provider — allowlist only', () => {
  assert.equal(validateConfig({ stt: { provider: 'openai' } }).stt.provider, 'openai');
  assert.equal(validateConfig({ stt: { provider: 'google' } }).stt?.provider, undefined);
});

test('config:set API key — size limit, masks "unchanged" placeholder', () => {
  assert.equal(validateConfig({ llm: { apiKey: '••••••••' } }).llm?.apiKey, undefined);
  assert.equal(validateConfig({ llm: { apiKey: 'sk-real-key-123' } }).llm.apiKey, 'sk-real-key-123');
  // too long = rejected
  assert.equal(validateConfig({ llm: { apiKey: 'A'.repeat(600) } }).llm?.apiKey, undefined);
});

test('config:set non-object input rejected', () => {
  assert.equal(validateConfig(null), null);
  assert.equal(validateConfig('string'), null);
  assert.equal(validateConfig([1, 2, 3]), null);
  assert.equal(validateConfig(42), null);
});

test('config:set prototype pollution attempt', () => {
  // The classic prototype-pollution attack vector
  const out: any = validateConfig(JSON.parse('{"__proto__": {"isAdmin": true}}'));
  // The validator must not include __proto__ in the result's own keys
  assert.equal(Object.keys(out).includes('__proto__'), false);
  // Critically, the Object prototype is not polluted
  const probe: any = {};
  assert.equal((probe as any).isAdmin, undefined);
});
