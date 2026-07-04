#!/usr/bin/env node
/* =====================================================================
   tooling-map.test.mjs — the acceptance suite for the tooling map.
   ---------------------------------------------------------------------
   This is the CONTRACT. The tooling map (docs/flowmap/_tooling.mmd) is
   "done" only when every test here is green — never on a prose claim.

     DETERMINISTIC — bundling tools/ twice yields byte-identical output
     FRESH         — the committed _tooling.mmd equals a fresh bundle
     VALID         — validate.mjs (grammar) exits 0
     ARCHITECTURAL — flowmap-lint.mjs (anti file-mirror) exits 0
     COMPLETE+TRUE — tooling-coverage.mjs (every module mapped, every
                     %% src resolves) exits 0

   Run: node --test tools/flowmap/verify/tooling-map.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const p = (...s) => join(ROOT, ...s);
const ROOT_TOOLS = p('docs', 'flowmap', 'root-tools.mmd');
const MAP = p('docs', 'flowmap', '_tooling.mmd');

function bundle() {
  return execFileSync('node', [p('tools', 'flowmap', 'verify', 'bundle.mjs'), '--root', ROOT_TOOLS, '--dir', p('tools')],
    { encoding: 'utf8', cwd: ROOT });
}
function run(script, ...args) {
  // execFileSync throws if exit code != 0 — that IS the assertion.
  return execFileSync('node', [p('tools', 'flowmap', 'verify', script), ...args], { encoding: 'utf8', cwd: ROOT });
}

test('DETERMINISTIC — two bundles are byte-identical', () => {
  assert.equal(bundle(), bundle());
});

test('FRESH — committed _tooling.mmd equals a fresh bundle', () => {
  assert.equal(readFileSync(MAP, 'utf8'), bundle(),
    'docs/flowmap/_tooling.mmd is stale — run `npm run flowmap:tooling:bundle`');
});

test('VALID — validate.mjs grammar check passes', () => {
  assert.doesNotThrow(() => run('validate.mjs', MAP));
});

test('ARCHITECTURAL — flowmap-lint passes (not a flat file-mirror)', () => {
  assert.doesNotThrow(() => run('flowmap-lint.mjs', MAP));
});

test('COMPLETE+TRUE — tooling-coverage passes', () => {
  assert.doesNotThrow(() => run('tooling-coverage.mjs',
    '--map', MAP, '--tools', p('tools'), '--allow', p('docs', 'flowmap', 'tooling-curation-allowlist.txt')));
});

/* ---- AUD5/F-08: the promised deny paths, exercised for the first time.
   "One unmapped module = exit 1 / one dangling pointer = exit 1" was
   ALLOW-only (AUD3 T5): all tests asserted pass on the real good map, so a
   mutation disabling the failure would have passed everything. ---- */

function coverage(mapPath, toolsDir) {
  return spawnSync('node', [p('tools', 'flowmap', 'verify', 'tooling-coverage.mjs'),
    '--map', mapPath, '--tools', toolsDir, '--allow', join(toolsDir, 'no-allowlist.txt')],
  { encoding: 'utf8', cwd: ROOT });
}

test('DENY — an UNMAPPED load-bearing module exits 1 (F-08)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tooling-cov-'));
  try {
    const tools = join(dir, 'tools');
    mkdirSync(tools);
    writeFileSync(join(tools, 'orphan.mjs'), 'export const x = 1;\n');
    const map = join(dir, 'map.mmd');
    writeFileSync(map, 'flowchart TB\n  a["a"]\n');            // no %% src at all
    const r = coverage(map, tools);
    assert.equal(r.status, 1, `unmapped module must exit 1; got ${r.status}\n${r.stdout}`);
    assert.match(r.stdout, /UNMAPPED/, 'names the unmapped module');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY — a dangling %% src (file does not exist) exits 1 (F-08)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tooling-cov-'));
  try {
    const tools = join(dir, 'tools');
    mkdirSync(tools);
    writeFileSync(join(tools, 'mod.mjs'), 'export const x = 1;\n');
    const map = join(dir, 'map.mmd');
    writeFileSync(map, `flowchart TB\n  a["a"]\n%% src a ${join(tools, 'mod.mjs')}\n%% src b ${join(tools, 'ghost.mjs')}\n`);
    const r = coverage(map, tools);
    assert.equal(r.status, 1, `dangling pointer must exit 1; got ${r.status}\n${r.stdout}`);
    assert.match(r.stdout, /DANGLING/, 'names the dangling pointer');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY — a %% src whose #symbol is not defined there exits 1 (F-08)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tooling-cov-'));
  try {
    const tools = join(dir, 'tools');
    mkdirSync(tools);
    writeFileSync(join(tools, 'mod.mjs'), 'export function realFn() {}\n');
    const map = join(dir, 'map.mmd');
    writeFileSync(map, `flowchart TB\n  a["a"]\n%% src a ${join(tools, 'mod.mjs')}#noSuchSymbol\n`);
    const r = coverage(map, tools);
    assert.equal(r.status, 1, `unresolvable symbol must exit 1; got ${r.status}\n${r.stdout}`);
    assert.match(r.stdout, /SYMBOL/, 'names the unresolvable symbol');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
