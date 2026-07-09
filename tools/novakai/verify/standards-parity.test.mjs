/* =====================================================================
   standards-parity.test.mjs — K11: docs/CODING_STANDARDS.md and
   eslint.config.js may never disagree. This is the doc<->config
   no-disagree enforcement (K11 §4): name parity, value parity, tier
   parity, the ratchet invariant, and the load-bearing behavioural
   assertion — the severity ESLint actually reports for a src/ide/*.ts
   file, proven via the eslint package's programmatic API (order-
   dependent flat-config severity cannot be caught by reading the
   declared config alone).
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const config = (await import(join(ROOT, 'eslint.config.js'))).default;
const warnBlock = config.find((b) => b.files?.includes('src/**/*.ts'));
const blockBlock = config.find((b) => b.files?.includes('src/ide/**/*.ts'));
assert.ok(warnBlock, 'eslint.config.js must have a src/**/*.ts block');
assert.ok(blockBlock, 'eslint.config.js must have a src/ide/**/*.ts block');
const warnRules = warnBlock.rules;
const blockRules = blockBlock.rules;

const doc = readFileSync(join(ROOT, 'docs', 'CODING_STANDARDS.md'), 'utf8');

// Parse the `| Rule | ESLint id | Threshold | Tier |` table.
const tableRows = [...doc.matchAll(/^\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|\s*(`[^`]+`|—)\s*\|\s*(.+?)\s*\|$/gm)];
assert.ok(tableRows.length >= 10, `expected >=10 rule rows in the doc table, found ${tableRows.length}`);
const docRules = new Map(tableRows.map((m) => [m[2], { threshold: m[3], tier: m[4] }]));

// Threshold extraction — one interpretation per rule shape.
function threshold(ruleValue) {
  if (!Array.isArray(ruleValue)) return undefined; // bare "warn"/"error" — no threshold
  const v = ruleValue[1];
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if ('max' in v) return v.max;
    if ('min' in v) return v.min;
    if ('code' in v) return v.code;
  }
  return undefined;
}

const numericRules = {
  'complexity': 10,
  'max-lines-per-function': 20,
  'max-lines': 500,
  'max-depth': 4,
  'max-params': 4,
  'max-statements': 12,
  'max-statements-per-line': 1,
  'max-len': 120,
  'id-length': 3,
};

test('name parity: doc table ids === config WARN-block ids', () => {
  const docIds = new Set(docRules.keys());
  const configIds = new Set(Object.keys(warnRules));
  assert.deepEqual([...docIds].sort(), [...configIds].sort(),
    'docs/CODING_STANDARDS.md rule table and eslint.config.js readabilityRules must list the same rule ids');
});

test('value parity: doc Threshold cell === config threshold, per numeric rule', () => {
  for (const [id, expected] of Object.entries(numericRules)) {
    const configValue = threshold(warnRules[id]);
    assert.equal(configValue, expected, `config threshold for ${id} should be ${expected}, got ${configValue}`);
    const docCell = docRules.get(id)?.threshold;
    assert.equal(docCell, `\`${expected}\``, `doc Threshold cell for ${id} should be \`${expected}\`, got ${docCell}`);
  }
});

test('tier parity: WARN block is "warn", BLOCK block is "error", doc names both tiers', () => {
  for (const id of Object.keys(warnRules)) {
    const warnSeverity = Array.isArray(warnRules[id]) ? warnRules[id][0] : warnRules[id];
    const blockSeverity = Array.isArray(blockRules[id]) ? blockRules[id][0] : blockRules[id];
    assert.equal(warnSeverity, 'warn', `${id} must be "warn" in the src/**/*.ts block`);
    assert.equal(blockSeverity, 'error', `${id} must be "error" in the src/ide/**/*.ts block`);
    const tierCell = docRules.get(id)?.tier ?? '';
    assert.match(tierCell, /WARN/, `doc Tier cell for ${id} must name WARN`);
    assert.match(tierCell, /BLOCK/, `doc Tier cell for ${id} must name BLOCK`);
  }
});

test('ratchet invariant: BLOCK-block threshold === WARN-block threshold, per numeric rule', () => {
  for (const id of Object.keys(numericRules)) {
    assert.equal(threshold(blockRules[id]), threshold(warnRules[id]),
      `${id} threshold must be identical in WARN and BLOCK blocks (severity differs, values do not)`);
  }
});

const PROMOTED = [
  'src/ide/**/*.ts',
  'src/core/context/**/*.ts',
  'src/core/history/**/*.ts',
  'src/core/diff/**/*.ts',
  'src/core/camera/**/*.ts',
  'src/core/config/**/*.ts',
  'src/core/frontmatter/**/*.ts',
  'src/core/persistence/**/*.ts',
  'src/core/plan/**/*.ts',
  'src/core/seed/**/*.ts',
  'src/core/state/**/*.ts',
  'src/core/validate/**/*.ts',
  'src/core/viewspec/**/*.ts',
  'src/panel/chrome/**/*.ts',
  'src/render/**/*.ts',
];

test('ratchet: promoted globs are exactly the error block, each named in the doc', () => {
  assert.deepEqual([...blockBlock.files].sort(), [...PROMOTED].sort(),
    'the error-block globs must equal the promoted list (promote by adding to BOTH)');
  for (const glob of PROMOTED) {
    assert.ok(doc.includes(`\`${glob}\``), `doc must name promoted glob \`${glob}\``);
  }
});

test('BLOCK behaviour: a promoted dir file reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.config.js', cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/core/history/_synthetic.ts' });
  const hit = res.messages.find((m) => m.ruleId === 'max-lines-per-function');
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic promoted-dir file');
  assert.equal(hit.severity, 2, 'promoted-dir violation must be reported as severity 2 (error/BLOCK)');
});

test('BLOCK behaviour: src/ide/*.ts reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.config.js', cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/ide/_synthetic.ts' });
  const hit = res.messages.find((m) => m.ruleId === 'max-lines-per-function');
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic src/ide file');
  assert.equal(hit.severity, 2, 'src/ide/*.ts violation must be reported as severity 2 (error/BLOCK)');
});

test('mirror: src/*.ts reports severity 1 (warn) for the same violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.config.js', cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/_synthetic.ts' });
  const hit = res.messages.find((m) => m.ruleId === 'max-lines-per-function');
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic src file');
  assert.equal(hit.severity, 1, 'src/*.ts violation must be reported as severity 1 (warn), not BLOCK');
});
