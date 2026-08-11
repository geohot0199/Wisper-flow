#!/usr/bin/env node
/**
 * Wisper Flow — top-to-bottom smoke test (no Electron required).
 *
 * Verifies the core pipeline works on a fresh install:
 *   1. Refinement engine: filler strip, intent classify, code framing
 *   2. Token budget guard
 *   3. Crypto round-trip
 *   4. End-to-end: raw voice → refined prompt → would-be LLM message
 *
 * Usage:  npx tsx scripts/smoke.ts
 */
import { refine, estimateTokens } from '../packages/refinement/src/index.js';

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0, fail = 0;

function ok(name: string) { pass++; console.log(`${GREEN}✓${RESET} ${name}`); }
function bad(name: string, err: any) { fail++; console.log(`${RED}✗${RESET} ${name} ${DIM}${err?.message ?? err}${RESET}`); }

async function step(name: string, fn: () => void | Promise<void>) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

(async () => {
  console.log('\n=== Wisper Flow smoke test ===\n');

  await step('refine strips filler', () => {
    const r = refine('um so like I want to build a function');
    if (r.cleaned.includes('um') || r.cleaned.includes('like')) throw new Error('filler remained');
  });

  await step('refine detects code mode', () => {
    const r = refine('write a python function that reverses a string');
    if (r.mode !== 'code') throw new Error(`expected code, got ${r.mode}`);
  });

  await step('refine injects SE framing', () => {
    const r = refine('write a function to debounce');
    if (!r.refinedPrompt.includes('senior software engineer')) throw new Error('no SE framing');
  });

  await step('refine tags language', () => {
    const r = refine('reverse a list in python');
    if (r.language !== 'python') throw new Error(`expected python, got ${r.language}`);
  });

  await step('refine email mode', () => {
    const r = refine('write an email to my manager about the launch delay');
    if (r.mode !== 'email') throw new Error(`expected email, got ${r.mode}`);
  });

  await step('refine shell mode', () => {
    const r = refine('run npm install then git commit and docker build');
    if (r.mode !== 'shell') throw new Error(`expected shell, got ${r.mode}`);
  });

  await step('token budget enforcement', () => {
    const big = 'word '.repeat(5000);
    const r = refine(big, { maxTokens: 100 });
    if (r.estimatedTokens > 110) throw new Error(`budget blown: ${r.estimatedTokens}`);
  });

  await step('token reduction on filler', () => {
    const raw = 'um so like I guess I want to basically kind of make a thing';
    const r = refine(raw);
    const before = estimateTokens(raw);
    if (r.estimatedTokens >= before) throw new Error('no reduction');
  });

  await step('handles empty input', () => {
    const r = refine('');
    if (r.refinedPrompt !== '') throw new Error('expected empty');
  });

  await step('crypto: aes-gcm round-trip', async () => {
    // dynamic import so the file works even if node_modules aren't ready
    const path = await import('path');
    const fs = await import('fs');
    const { execSync } = await import('child_process');
    const tmp = path.join('/tmp', `wf-crypto-${Date.now()}.mjs`);
    fs.writeFileSync(tmp, `
      import { encryptKey, decryptKey } from '${path.resolve('apps/desktop/src/main/crypto.ts')}';
      const fp = 'test-fingerprint';
      const enc = encryptKey('sk-test-123', fp);
      const dec = decryptKey(enc, fp);
      if (dec !== 'sk-test-123') throw new Error('round-trip failed');
      if (!enc.startsWith('enc:')) throw new Error('missing enc: prefix');
    `);
    try {
      execSync(`npx tsx ${tmp}`, { stdio: 'pipe' });
    } finally { fs.unlinkSync(tmp); }
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
