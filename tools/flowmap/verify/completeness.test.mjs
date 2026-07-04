/* =====================================================================
   completeness.test.mjs — AUD5/F-11: deny fixtures for the A1 completeness
   pair (coverage.mjs, exports-coverage.mjs) and validate.mjs.

   AUD3 T6: these guards' "exit 1" deny claims were proven only by running
   on good data in CI — no fixture anywhere forced the failure, so a
   mutation disabling any of them was invisible to the suite. The missing
   deny tests ARE the fix (register F-11): an uncovered file → 1, a hidden
   export → 1, a grammar error → 1 — each via the real spawned CLI.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function cli(rel, args) {
  return spawnSync('node', [rel, ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/* ---------- coverage.mjs (A1, file level) ---------- */

test('coverage.mjs DENY: an uncovered source file exits 1; covering it exits 0 (F-11)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'completeness-'));
  try {
    const src = join(dir, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'lonely.ts'), 'export const x = 1;\n');
    const root = join(dir, 'root.mmd');
    writeFileSync(root, 'flowchart TB\n  a["a"]\n');
    const bad = cli('tools/flowmap/verify/coverage.mjs', ['--src', src, '--root', root]);
    assert.equal(bad.status, 1, `uncovered file must exit 1:\n${bad.stdout}${bad.stderr}`);
    assert.match(bad.stdout, /lonely\.ts/, 'names the uncovered file');
    writeFileSync(root, `flowchart TB\n  a["a"]\n%% src a ${join(src, 'lonely.ts')}#x\n`);
    const good = cli('tools/flowmap/verify/coverage.mjs', ['--src', src, '--root', root]);
    assert.equal(good.status, 0, `covered file must exit 0:\n${good.stdout}${good.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- exports-coverage.mjs (A1, symbol level) ---------- */

test('exports-coverage.mjs DENY: a hidden export exits 1; allowlisting it exits 0 (F-11)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'completeness-'));
  try {
    const src = join(dir, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'mod.ts'), 'export function hiddenFn(): number { return 1; }\n');
    writeFileSync(join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }));
    const map = join(dir, 'map.mmd');
    writeFileSync(map, 'flowchart TB\n  a["a"]\n');   // map knows nothing of hiddenFn
    const allow = join(dir, 'allow.txt');
    writeFileSync(allow, '');
    const args = ['--map', map, '--tsconfig', join(dir, 'tsconfig.json'), '--src', src, '--allow', allow];
    const bad = cli('tools/flowmap/verify/exports-coverage.mjs', args);
    assert.equal(bad.status, 1, `hidden export must exit 1:\n${bad.stdout}${bad.stderr}`);
    assert.match(bad.stdout, /hiddenFn/, 'names the hidden export');
    writeFileSync(allow, 'hiddenFn   # fixture: audited exclusion\n');
    const good = cli('tools/flowmap/verify/exports-coverage.mjs', args);
    assert.equal(good.status, 0, `allowlisted export must exit 0:\n${good.stdout}${good.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- validate.mjs (grammar) ---------- */

test('validate.mjs DENY: a grammar error exits 1; a valid map exits 0; no arg exits 2 (F-11)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'completeness-'));
  try {
    const bad = join(dir, 'bad.mmd');
    writeFileSync(bad, 'flowchart TB\n  a["a"]\n  a --> ghostNode\n'); // edge to undefined node
    const rBad = cli('tools/flowmap/verify/validate.mjs', [bad]);
    assert.equal(rBad.status, 1, `grammar error must exit 1:\n${rBad.stdout}${rBad.stderr}`);
    const good = join(dir, 'good.mmd');
    writeFileSync(good, 'flowchart TB\n  a["a"]\n  b["b"]\n  a --> b\n');
    const rGood = cli('tools/flowmap/verify/validate.mjs', [good]);
    assert.equal(rGood.status, 0, `valid map must exit 0:\n${rGood.stdout}${rGood.stderr}`);
    assert.equal(cli('tools/flowmap/verify/validate.mjs', []).status, 2, 'no arg is a usage error (2)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
