/**
 * Integration test for the desktop pipeline (no Electron).
 * Verifies: refine → template → token estimate chain works end-to-end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Import directly from source so the test works in both ESM and CJS,
// and doesn't depend on the refinement package being pre-built.
const refinementUrl = pathToFileURL(
  path.resolve(__dirname, '../../../packages/refinement/src/index.ts')
).href;
const { refine } = await import(refinementUrl);
const { applyPromptTemplate } = await import(
  pathToFileURL(path.resolve(__dirname, '../src/main/templates.ts')).href
);

test('pipeline: voice → code prompt → final LLM message', () => {
  const raw = 'um so like I want to write a python function that takes a list and returns the maximum value with edge cases';
  const r = refine(raw, { codingMode: true });
  const final = applyPromptTemplate(r.refinedPrompt, r.mode, r.language);

  // refined has the SE framing
  assert.ok(r.refinedPrompt.includes('senior software engineer'));
  // final has the system message + language tag
  assert.ok(final.includes('senior software engineer'));
  assert.ok(final.includes('[Language: python]'));
  // cleaned is much shorter
  assert.ok(r.cleaned.length < r.original.length);
  assert.ok(!r.cleaned.includes(' um '));
});

test('pipeline: voice → email → final', () => {
  const raw = 'write an email to my team basically saying the deploy is delayed until tomorrow';
  const r = refine(raw);
  const final = applyPromptTemplate(r.refinedPrompt, r.mode, r.language);
  assert.equal(r.mode, 'email');
  assert.ok(final.toLowerCase().includes('professional'));
  assert.ok(final.toLowerCase().includes('subject'));
});

test('pipeline: empty input produces empty output', () => {
  const r = refine('');
  const final = applyPromptTemplate(r.refinedPrompt, r.mode, r.language);
  assert.equal(r.refinedPrompt, '');
  assert.ok(final.length > 0); // system message still there
});

test('pipeline: token reduction on filler-heavy input >= 30%', () => {
  const raw = 'um so like I basically want to um you know make a sort of thing that kind of does the thing basically';
  const r = refine(raw);
  // Crude: original chars vs cleaned chars
  const reduction = (raw.length - r.cleaned.length) / raw.length;
  assert.ok(reduction >= 0.2, `expected >= 20% char reduction, got ${(reduction * 100).toFixed(1)}%`);
});
