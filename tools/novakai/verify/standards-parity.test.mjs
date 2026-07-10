/* =====================================================================
   standards-parity.test.mjs — K11: docs/CODING_STANDARDS.md and
   eslint.config.js may never disagree. This is the doc<->config
   no-disagree enforcement (K11 §4): name parity, value parity, the
   single-BLOCK-tier guarantee (no warn severity anywhere — the WARN
   entry ramp retired in whole-repo session 4 may not come back), the
   collapsed three-block config shape, the exclusion ledger, and the
   load-bearing behavioural assertions — the severity ESLint actually
   reports per file class, proven via the eslint package's programmatic
   API (declared config alone cannot prove effective severity).
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
const tsBlock = config.find((block) => block.files?.includes('src/**/*.ts'));
const jsBlock = config.find((block) => block.files?.includes('tools/**/*.mjs'));
assert.ok(tsBlock, 'eslint.config.js must have the TypeScript block (src/**/*.ts)');
assert.ok(jsBlock, 'eslint.config.js must have the plain-JS block (tools/**/*.mjs)');
const rules = tsBlock.rules;

function severityOf(ruleValue) {
  return Array.isArray(ruleValue) ? ruleValue[0] : ruleValue;
}

const doc = readFileSync(join(ROOT, 'docs', 'CODING_STANDARDS.md'), 'utf8');

// Parse the `| Rule | ESLint id | Threshold | Tier |` table.
const tableRows = [...doc.matchAll(/^\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|\s*(`[^`]+`|—)\s*\|\s*(.+?)\s*\|$/gm)];
assert.ok(tableRows.length >= 10, `expected >=10 rule rows in the doc table, found ${tableRows.length}`);
const docRules = new Map(tableRows.map((row) => [row[2], { threshold: row[3], tier: row[4] }]));

// Threshold extraction — one interpretation per rule shape.
function threshold(ruleValue) {
  if (!Array.isArray(ruleValue)) return undefined; // bare "error" — no threshold
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

test('name parity: doc table ids === config rule ids, identical in both blocks', () => {
  const docIds = [...docRules.keys()].sort();
  assert.deepEqual(docIds, Object.keys(rules).sort(),
    'docs/CODING_STANDARDS.md rule table and eslint.config.js readabilityRules must list the same rule ids');
  assert.deepEqual(Object.keys(jsBlock.rules).sort(), Object.keys(rules).sort(),
    'the TS and plain-JS blocks must share the same rule set');
});

test('value parity: doc Threshold cell === config threshold, per numeric rule', () => {
  for (const [id, expected] of Object.entries(numericRules)) {
    const configValue = threshold(rules[id]);
    assert.equal(configValue, expected, `config threshold for ${id} should be ${expected}, got ${configValue}`);
    const docCell = docRules.get(id)?.threshold;
    assert.equal(docCell, `\`${expected}\``, `doc Threshold cell for ${id} should be \`${expected}\`, got ${docCell}`);
  }
});

test('single tier: every rule is "error" in both blocks, every doc Tier cell names BLOCK', () => {
  for (const id of Object.keys(rules)) {
    assert.equal(severityOf(rules[id]), 'error', `${id} must be "error" in the TS block`);
    assert.equal(severityOf(jsBlock.rules[id]), 'error', `${id} must be "error" in the plain-JS block`);
    const tierCell = docRules.get(id)?.tier ?? '';
    assert.match(tierCell, /BLOCK/, `doc Tier cell for ${id} must name BLOCK`);
  }
});

test('no warn tier remains: no rule in any config block is warn-severity, no WARN Tier cell', () => {
  for (const block of config) {
    for (const [id, value] of Object.entries(block.rules ?? {})) {
      const severity = severityOf(value);
      assert.ok(severity !== 'warn' && severity !== 1,
        `${id} is warn-severity in a config block — the WARN entry ramp was retired in whole-repo session 4`);
    }
  }
  for (const [id, { tier }] of docRules) {
    assert.ok(!/WARN/.test(tier), `doc Tier cell for ${id} may not name WARN (single-tier model)`);
  }
});

test('collapsed shape: exactly one ignores block + the two whole-glob rule blocks', () => {
  const ruleBlocks = config.filter((block) => block.files);
  assert.equal(ruleBlocks.length, 2, 'exactly two files-scoped blocks (TS + plain JS)');
  assert.deepEqual([...tsBlock.files].sort(), ['*.ts', 'src/**/*.ts', 'tests/**/*.ts'],
    'the TS block must cover src/**, tests/** and the root harness');
  assert.deepEqual([...jsBlock.files].sort(), ['*.js', '*.mjs', 'tests/**/*.mjs', 'tools/**/*.mjs'],
    'the plain-JS block must cover tools/**, tests/** and the root harness');
});

test('no carve-out: no config block names an exact tools file path (per-file softening is gone)', () => {
  const perFileBlocks = config.filter((block) =>
    block.files?.some((glob) => String(glob).startsWith('tools/') && !String(glob).includes('*')));
  assert.deepEqual(perFileBlocks, [],
    'the max-lines carve-out was removed in whole-repo session 3 and may not come back');
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

test('ex-carve-out behaviour: audit-run.mjs gets max-lines at severity 2 like any tools file', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `let zz = 1;\n${'zz += 1;\n'.repeat(510)}`;
  const [res] = await eslint.lintText(src, { filePath: 'tools/novakai/audit/audit-run.mjs' });
  const maxLines = res.messages.find((msg) => msg.ruleId === 'max-lines');
  assert.ok(maxLines, 'expected a max-lines violation on the synthetic oversized text');
  assert.equal(maxLines.severity, 2, 'the ex-carve-out file must report max-lines at severity 2 (error/BLOCK)');
});

test('BLOCK behaviour: a src subdirectory file reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/core/history/_synthetic.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic src subdirectory file');
  assert.equal(hit.severity, 2, 'src subdirectory violation must be reported as severity 2 (error/BLOCK)');
});

test('BLOCK behaviour: src/ide/*.ts reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/ide/_synthetic.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic src/ide file');
  assert.equal(hit.severity, 2, 'src/ide/*.ts violation must be reported as severity 2 (error/BLOCK)');
});

test('ex-WARN surface: a root src/*.ts file reports severity 2 (error) — the mirror flipped in session 4', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/_synthetic.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic src file');
  assert.equal(hit.severity, 2, 'src/*.ts violation must be severity 2 (error/BLOCK) — no WARN surface remains');
});

test('ex-WARN surface: src/main.ts itself reports severity 2 (error) for a real violation', async () => {
  const eslint = new ESLint({ overrideConfigFile: ESLINT_CONFIG_FILE, cwd: ROOT });
  const src = `export function x() {\n${'  const a = 1;\n'.repeat(70)}}\n`;
  const [res] = await eslint.lintText(src, { filePath: 'src/main.ts' });
  const hit = res.messages.find((msg) => msg.ruleId === MAX_LINES_PER_FUNCTION);
  assert.ok(hit, 'expected a max-lines-per-function violation on the synthetic main.ts text');
  assert.equal(hit.severity, 2, 'src/main.ts violation must be severity 2 — the last WARN surface is gone');
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
