/* =====================================================================
   agents-stream.test.ts — acceptance + edge-case tests for
   src/ide/agents-stream.ts (mdTokens, revealStep, eventLabel)
   ---------------------------------------------------------------------
   The ten acceptance cases below are copied verbatim from
   docs/novakai/plans/k6-agents.plan.json (k6-ui-stream, k6-ui-stream-pace,
   k6-ui-stream-label) — Keystone-2 behavioural contracts, checked
   byte-for-byte via deepStrictEqual.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdTokens, revealStep, eventLabel } from '../../src/ide/agents-stream.ts';

// ---------------------------------------------------------------------
// mdTokens — acceptance cases (k6-ui-stream)
// ---------------------------------------------------------------------

test('mdTokens: inline bold and code tokenize', () => {
  assert.deepStrictEqual(mdTokens('hi **b** `c`'), [
    { t: 'p', parts: [
      { t: 'text', v: 'hi ' },
      { t: 'b', v: 'b' },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'c' },
    ] },
  ]);
});

test('mdTokens: fenced block keeps lang and body', () => {
  assert.deepStrictEqual(mdTokens('```ts\nconst x = 1\n```'), [
    { t: 'codeblock', lang: 'ts', v: 'const x = 1' },
  ]);
});

test('mdTokens: blank line splits paragraphs', () => {
  assert.deepStrictEqual(mdTokens('a\n\nb'), [
    { t: 'p', parts: [{ t: 'text', v: 'a' }] },
    { t: 'p', parts: [{ t: 'text', v: 'b' }] },
  ]);
});

// ---------------------------------------------------------------------
// mdTokens — edge cases
// ---------------------------------------------------------------------

test('mdTokens: unclosed fence swallows the rest as codeblock body', () => {
  assert.deepStrictEqual(mdTokens('```js\nconst x = 1'), [
    { t: 'codeblock', lang: 'js', v: 'const x = 1' },
  ]);
});

test('mdTokens: nested backtick inside bold stays literal text, not a code span', () => {
  assert.deepStrictEqual(mdTokens('**bold `not code`**'), [
    { t: 'p', parts: [{ t: 'b', v: 'bold `not code`' }] },
  ]);
});

test('mdTokens: unterminated inline marker falls back to plain text', () => {
  assert.deepStrictEqual(mdTokens('hi **oops'), [
    { t: 'p', parts: [{ t: 'text', v: 'hi **oops' }] },
  ]);
});

// ---------------------------------------------------------------------
// revealStep — acceptance cases (k6-ui-stream-pace)
// ---------------------------------------------------------------------

test('revealStep: empty buffer reveals nothing', () => {
  assert.deepStrictEqual(revealStep(0, 16), 0);
});

test('revealStep: small backlog drips at the calm base rate', () => {
  assert.deepStrictEqual(revealStep(10, 100), 8);
});

test('revealStep: huge backlog is clamped to the fast ceiling', () => {
  assert.deepStrictEqual(revealStep(5000, 100), 200);
});

// ---------------------------------------------------------------------
// eventLabel — acceptance cases (k6-ui-stream-label)
// ---------------------------------------------------------------------

test('eventLabel: edit shows the path', () => {
  assert.deepStrictEqual(eventLabel({ name: 'Edit', input: { file_path: 'src/ide/agents.ts' } }), 'editing src/ide/agents.ts');
});

test('eventLabel: read shows the path', () => {
  assert.deepStrictEqual(eventLabel({ name: 'Read', input: { file_path: 'css/agents.css' } }), 'reading css/agents.css');
});

test('eventLabel: bash shows its description, lowercased', () => {
  assert.deepStrictEqual(eventLabel({ name: 'Bash', input: { description: 'Install deps' } }), 'install deps');
});

test('eventLabel: unknown tools stay silent', () => {
  assert.deepStrictEqual(eventLabel({ name: 'TodoWrite', input: {} }), null);
});

test('eventLabel: bash with no description falls back to a quiet default', () => {
  assert.deepStrictEqual(eventLabel({ name: 'Bash', input: {} }), 'running a command');
});
