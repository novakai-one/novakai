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

const ESLINT_CONFIG_FILE = 'eslint.config.js';
const config = (await import(join(ROOT, ESLINT_CONFIG_FILE))).default;
const warnBlock = config.find((block) => block.files?.includes('src/**/*.ts'));
const blockBlock = config.find((block) => block.files?.includes('src/ide/**/*.ts'));
assert.ok(warnBlock, 'eslint.config.js must have a src/**/*.ts block');
assert.ok(blockBlock, 'eslint.config.js must have a src/ide/**/*.ts block');

function severityOf(ruleValue) {
  return Array.isArray(ruleValue) ? ruleValue[0] : ruleValue;
}
// Two blocks share the tools/**/*.mjs glob (WARN base + BLOCK ratchet);
// discriminate by declared severity, not position.
const toolsBlocks = config.filter((block) => block.files?.includes('tools/**/*.mjs'));
const toolsBlockBlock = toolsBlocks.find((block) => severityOf(block.rules?.['max-len']) === 'error');
const CARVE_OUTS = [
  'tools/novakai/audit/audit-run.mjs',
  'tools/novakai/contract/loop-e2e.test.mjs',
];
const carveOutBlock = config.find((block) =>
  CARVE_OUTS.every((file) => block.files?.includes(file)));
const warnRules = warnBlock.rules;
const blockRules = blockBlock.rules;

const doc = readFileSync(join(ROOT, 'docs', 'CODING_STANDARDS.md'), 'utf8');

// Parse the `| Rule | ESLint id | Threshold | Tier |` table.
const tableRows = [...doc.matchAll(/^\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|\s*(`[^`]+`|—)\s*\|\s*(.+?)\s*\|$/gm)];
assert.ok(tableRows.length >= 10, `expected >=10 rule rows in the doc table, found ${tableRows.length}`);
const docRules = new Map(tableRows.map((row) => [row[2], { threshold: row[3], tier: row[4] }]));

// Threshold extraction — one interpretation per rule shape.
function threshold(ruleValue) {
  if (!Array.isArray(ruleValue)) return undefined; // bare "warn"/"error" — no threshold
  const val = ruleValue[1];
  if (val === undefined) return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    if ('max' in val) return val.max;
    if ('min' in val) return val.min;
    if ('code' in val) return val.code;
  }
  return undefined;
}

const MAX_LINES_PER_FUNCTION = 'max-lines-per-function';

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
  'src/interaction/**/*.ts',
  'src/io/**/*.ts',
  'src/panel/**/*.ts',
  'src/render/**/*.ts',
];

test('ratchet: promoted globs are exactly the error block, each named in the doc', () => {
  assert.deepEqual([...blockBlock.files].sort(), [...PROMOTED].sort(),
    'the error-block globs must equal the promoted list (promote by adding to BOTH)');
  for (const glob of PROMOTED) {
    assert.ok(doc.includes(`\`${glob}\``), `doc must name promoted glob \`${glob}\``);
  }
});

test('tools ratchet: an error-tier tools/**/*.mjs block exists, every rule at "error"', () => {
  assert.ok(toolsBlockBlock, 'eslint.config.js must have an error-severity tools/**/*.mjs block');
  for (const id of Object.keys(warnRules)) {
    assert.equal(severityOf(toolsBlockBlock.rules[id]), 'error',
      `${id} must be "error" in the tools/**/*.mjs BLOCK block`);
  }
  assert.ok(doc.includes('`tools/**/*.mjs`'), 'doc must name the promoted glob `tools/**/*.mjs`');
});

test('tools carve-outs: exactly the two oversized files, max-lines-only, named in the doc', () => {
  assert.ok(carveOutBlock, 'eslint.config.js must have the max-lines carve-out block');
  assert.deepEqual([...carveOutBlock.files].sort(), [...CARVE_OUTS].sort(),
    'the carve-out block must cover exactly the two oversized files');
  assert.deepEqual(Object.keys(carveOutBlock.rules), ['max-lines'],
    'the carve-out block may soften ONLY max-lines — every other rule stays BLOCK');
  assert.equal(severityOf(carveOutBlock.rules['max-lines']), 'warn');
  assert.equal(threshold(carveOutBlock.rules['max-lines']), numericRules['max-lines'],
    'the carve-out keeps the same max-lines threshold (severity differs, value does not)');
  for (const file of CARVE_OUTS) {
    assert.ok(doc.includes(`\`${file}\``), `doc must name carve-out \`${file}\``);
  }
});

test('BLOCK behaviour: a tools/**/*.mjs file reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  // espree (unlike the TS parser) rejects redeclared consts, so reassign instead
  const src = `export function x() {\n  let count = 0;\n${'  count += 1;\n'.repeat(70)}  return count;\n}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'tools/novakai/verify/_synthetic.mjs' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic tools file');
  assert.equal(hit.severity, 2, 'tools/**/*.mjs violation must be reported as severity 2 (error/BLOCK)');
});

test('carve-out behaviour: audit-run.mjs gets max-lines at severity 1 but other rules at severity 2', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `let zz = 1;\n${'zz += 1;\n'.repeat(510)}`;
  const [res] = await eslint.lintText(src, { filePath: 'tools/novakai/audit/audit-run.mjs' });
  const maxLines = res.messages.find((msg) => msg.ruleId === 'max-lines');
  assert.ok(maxLines, 'expected a max-lines violation on the synthetic oversized carve-out text');
  assert.equal(maxLines.severity, 1, 'carve-out file max-lines must stay severity 1 (warn)');
  const idLength = res.messages.find((msg) => msg.ruleId === 'id-length');
  assert.ok(idLength, 'expected an id-length violation (zz) in the synthetic text');
  assert.equal(idLength.severity, 2, 'every non-max-lines rule must still be severity 2 on the carve-out file');
});

test('BLOCK behaviour: a promoted dir file reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/core/history/_synthetic.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic promoted-dir file');
  assert.equal(hit.severity, 2, 'promoted-dir violation must be reported as severity 2 (error/BLOCK)');
});

test('BLOCK behaviour: src/ide/*.ts reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/ide/_synthetic.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic src/ide file');
  assert.equal(hit.severity, 2, 'src/ide/*.ts violation must be reported as severity 2 (error/BLOCK)');
});

test('mirror: src/*.ts reports severity 1 (warn) for the same violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/_synthetic.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic src file');
  assert.equal(hit.severity, 1, 'src/*.ts violation must be reported as severity 1 (warn), not BLOCK');
});

// ---------------------------------------------------------------------
// Whole-repo ratchet (session 1): exclusion ledger + tests/root tiers.
// ---------------------------------------------------------------------

const LEDGER = [
  'dist/**',
  'node_modules/**',
  '.readability/**',
  'coverage/**',
  '**/*.json',
  '**/*.mmd',
  '**/*.d.ts',
  'tools/buildspec/__fixtures__/**',
];

test('exclusion ledger: config ignores === pinned ledger, each path named in the doc', () => {
  const ignoresBlock = config.find((block) => block.ignores && !block.files);
  assert.ok(ignoresBlock, 'eslint.config.js must have a global ignores block');
  assert.deepEqual([...ignoresBlock.ignores].sort(), [...LEDGER].sort(),
    'the config ignores must equal the pinned exclusion ledger (extend BOTH plus the doc table)');
  for (const path of LEDGER) {
    assert.ok(doc.includes(`\`${path}\``), `doc exclusion-ledger table must name \`${path}\``);
  }
});

test('tests tier: a tests/** violation reports severity 2 (error) — promoted in whole-repo session 2', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'tests/characterization/_synthetic.test.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic tests file');
  assert.equal(hit.severity, 2, 'tests/** violation must be severity 2 (error/BLOCK) after the session-2 burn');
});

test('root harness tier: root *.ts and *.mjs violations report severity 2 (error)', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [tsRes] = await eslint.lintText(src, { filePath: '_synthetic.config.ts' });
  assert.equal(tsRes.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION)?.severity, 2,
    'a root *.ts violation must be severity 2 (error/BLOCK)');
  // espree (unlike the TS parser) rejects redeclared consts, so reassign instead
  const mjsSrc = `export function x() {\n  let count = 0;\n${'  count += 1;\n'.repeat(70)}  return count;\n}\n`;
  const [mjsRes] = await eslint.lintText(mjsSrc, { filePath: '_synthetic.mjs' });
  assert.equal(mjsRes.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION)?.severity, 2,
    'a root *.mjs violation must be severity 2 (error/BLOCK)');
});
