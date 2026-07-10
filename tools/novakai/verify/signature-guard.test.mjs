/* =====================================================================
   signature-guard.test.mjs — contract-frozen signatures cannot drift.
   ---------------------------------------------------------------------
   The repeat-mistake stopper: a cleanup agent once "fixed" a max-params
   warning on a function the approved plan + acceptance corpus call
   positionally — a contract break dressed as a style fix. This guard
   makes that impossible to land silently:

   1. every entry in frozen-signatures.json must match the live map
      (docs/novakai/_bundle.mmd i0.accepts lines + %% src anchor) — the
      ship gate proves map == code, so pin == map == code;
   2. every freezing artifact named in anchoredBy must exist and still
      reference the frozen symbol;
   3. the in-code eslint-disable comment must exist and the repo-wide
      set of eslint-disable files must equal the manifest — no third
      disable can appear without a manifest entry (and doc row).

   Changing a frozen signature is allowed ONLY by resyncing the contract
   artifact, this manifest, and docs/CODING_STANDARDS.md's registry
   table in the same change.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(HERE, 'frozen-signatures.json'), 'utf8'));
const bundle = readFileSync(join(ROOT, 'docs', 'novakai', '_bundle.mmd'), 'utf8');
const doc = readFileSync(join(ROOT, 'docs', 'CODING_STANDARDS.md'), 'utf8');

// composed so this file's own source never matches the scan below
const DISABLE_MARK = 'eslint-' + 'disable';

function acceptsOf(node) {
  const line = new RegExp(`^%% fm:meta ${node} i0\\.accepts=(.*)$`, 'gm');
  return [...bundle.matchAll(line)].map((hit) => hit[1]);
}

function srcAnchorOf(node) {
  const hit = bundle.match(new RegExp(`^%% src ${node} (\\S+)$`, 'm'));
  return hit ? hit[1] : null;
}

function checkAnchor(anchor) {
  const [file, ref] = anchor.split('#');
  assert.ok(existsSync(join(ROOT, file)), `anchoredBy artifact missing: ${file}`);
  if (ref === undefined) return;
  const text = readFileSync(join(ROOT, file), 'utf8');
  assert.ok(text.includes(ref), `anchoredBy artifact ${file} no longer references "${ref}"`);
}

function filesWithDisable() {
  try {
    const out = execFileSync(
      'git', ['grep', '-l', DISABLE_MARK, '--', '*.ts', '*.mjs', '*.js'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return out.split('\n').filter(Boolean).sort();
  } catch {
    return []; // git grep exits 1 on zero matches
  }
}

test('manifest shape: v1, non-empty, unique nodes', () => {
  assert.equal(manifest.v, 1);
  assert.ok(manifest.frozen.length >= 2, 'the two founding entries must be present');
  const nodes = manifest.frozen.map((entry) => entry.node);
  assert.equal(new Set(nodes).size, nodes.length, 'duplicate node in manifest');
});

for (const entry of manifest.frozen) {
  test(`frozen signature intact in the map: ${entry.node}`, () => {
    assert.deepEqual(acceptsOf(entry.node), entry.accepts,
      `${entry.node}'s live signature drifted from the contract pin — this is a CONTRACT change. ` +
      `Either revert the signature, or deliberately resync: the anchoring artifact(s) ` +
      `[${entry.anchoredBy.join(', ')}], frozen-signatures.json, and the registry table in ` +
      'docs/CODING_STANDARDS.md, all in the same change.');
    assert.equal(srcAnchorOf(entry.node), `${entry.file}#${entry.symbol}`,
      `${entry.node} must stay anchored at ${entry.file}#${entry.symbol}`);
  });

  test(`freezing artifacts still exist and reference: ${entry.node}`, () => {
    for (const anchor of entry.anchoredBy) checkAnchor(anchor);
  });

  test(`in-code disable comment present and doc row named: ${entry.node}`, () => {
    const source = readFileSync(join(ROOT, entry.file), 'utf8');
    assert.ok(source.includes(`${DISABLE_MARK} ${entry.eslintDisable.join(', ')}`),
      `${entry.file} must carry "${DISABLE_MARK} ${entry.eslintDisable.join(', ')}" naming its contract`);
    assert.ok(doc.includes(entry.file) && doc.includes(entry.symbol),
      `docs/CODING_STANDARDS.md registry table must name ${entry.file} · ${entry.symbol}`);
  });
}

test('repo-wide: eslint-disable appears ONLY in manifest-registered files', () => {
  const expected = manifest.frozen.map((entry) => entry.file).sort();
  assert.deepEqual(filesWithDisable(), expected,
    'a new eslint-disable requires a frozen-signatures.json entry + doc registry row — ' +
    'if the signature is not contract-frozen, fix the code instead of disabling the rule');
});
