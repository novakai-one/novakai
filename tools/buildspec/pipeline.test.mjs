/* =====================================================================
   pipeline.test.mjs — zero-dependency test suite (node --test).
   Covers: parser, the hand-verified extractor graph (the doc-mandated
   check against silent undercount), every gate drift class, the full
   generate->extract->gate round-trip, and that generated stubs compile.
   Run: npm run spec:test
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Project } from 'ts-morph';

import { parseMmd, realNodeIds } from './mmd-parse.mjs';
import { specSkeletons } from './skeleton.mjs';
import { diffSkeletons } from './diff-core.mjs';
import { extract } from './extract.mjs';
import { generate } from './spec-to-stubs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '__fixtures__');
const SAMPLE = join(FIX, 'sample.mmd');
const SAMPLE_SRC = join(FIX, 'sample-src');

function projectFrom(dir) {
  const p = new Project({ compilerOptions: { allowJs: false }, useInMemoryFileSystem: false });
  p.addSourceFilesAtPaths(join(dir, '**/*.ts'));
  return p;
}

test('parser reads nodes, kinds and edges', () => {
  const m = parseMmd(readFileSync(SAMPLE, 'utf8'));
  assert.deepEqual(realNodeIds(m).sort(), ['Shape', 'helper', 'store', 'validate']);
  assert.equal(m.nodes.store.kind, 'class');
  assert.equal(m.nodes.Shape.kind, 'type');
  assert.equal(m.edges.length, 1);
  assert.equal(m.roots[0], 'store');
});

test('extractor produces the hand-verified graph (guards silent undercount)', () => {
  const got = specSkeletons(extract(projectFrom(SAMPLE_SRC)));
  const expected = {
    store: {
      id: 'store', kind: 'class', parent: null,
      members: [
        { name: 'get', arity: 0, returnsValue: true, paramTypes: [], returnType: 'number' },
        { name: 'set', arity: 1, returnsValue: false, paramTypes: ['number'], returnType: 'void' },
      ],
    },
    validate: {
      id: 'validate', kind: 'function', parent: null,
      members: [{ name: 'isValid', arity: 1, returnsValue: true, paramTypes: ['number'], returnType: 'boolean' }],
    },
    Shape: { id: 'Shape', kind: 'type', parent: null, members: [] },
    helper: {
      id: 'helper', kind: 'function', parent: 'store',
      members: [{ name: 'helper', arity: 2, returnsValue: false, paramTypes: ['number', 'number'], returnType: 'void' }],
    },
  };
  assert.deepEqual(got, expected);
});

test('private members are excluded from the skeleton', () => {
  const got = specSkeletons(extract(projectFrom(SAMPLE_SRC)));
  assert.ok(!got.store.members.some((m) => m.name === '_secret'));
});

test('gate passes when spec matches hand-written code', () => {
  const spec = specSkeletons(parseMmd(readFileSync(SAMPLE, 'utf8')));
  const code = specSkeletons(extract(projectFrom(SAMPLE_SRC)));
  const { errors } = diffSkeletons(spec, code);
  assert.deepEqual(errors, []);
});

test('gate catches every drift class', () => {
  const spec = specSkeletons(parseMmd(readFileSync(SAMPLE, 'utf8')));
  const base = () => JSON.parse(JSON.stringify(spec)); // deep clone of a clean code-side

  const cases = [
    ['unbuilt', (c) => { delete c.store; }],
    ['unplanned', (c) => { c.ghost = { id: 'ghost', kind: 'function', parent: null, members: [] }; }],
    ['kind mismatch', (c) => { c.validate.kind = 'class'; }],
    ['parent mismatch', (c) => { c.helper.parent = null; }],
    ['missing member', (c) => { c.store.members = c.store.members.filter((m) => m.name !== 'get'); }],
    ['arity mismatch', (c) => { c.helper.members[0].arity = 1; }],
    ['return mismatch', (c) => { c.store.members.find((m) => m.name === 'set').returnsValue = true; }],
    ['param type mismatch', (c) => { c.helper.members[0].paramTypes[0] = 'string'; }],
    ['return type mismatch', (c) => { c.store.members.find((m) => m.name === 'get').returnType = 'string'; }],
  ];
  for (const [label, mutate] of cases) {
    const code = base();
    mutate(code);
    const { errors } = diffSkeletons(spec, code);
    assert.ok(errors.some((e) => e.startsWith(label)), `expected a "${label}" error, got: ${errors.join(' | ')}`);
  }
});

test('round-trip: generate -> extract -> gate is green, and a signature change fails it', () => {
  const out = mkdtempSync(join(tmpdir(), 'bs-rt-'));
  try {
    generate(SAMPLE, out, true);
    const spec = specSkeletons(parseMmd(readFileSync(SAMPLE, 'utf8')));

    let code = specSkeletons(extract(projectFrom(out)));
    assert.deepEqual(diffSkeletons(spec, code).errors, [], 'clean round-trip should pass');

    // mutate a generated signature: drop a parameter from helper
    const hp = join(out, 'helper.ts');
    writeFileSync(hp, readFileSync(hp, 'utf8').replace('(_a: number, _b: number)', '(_a: number)'));
    code = specSkeletons(extract(projectFrom(out)));
    assert.ok(diffSkeletons(spec, code).errors.some((e) => e.startsWith('arity mismatch')), 'signature change must fail the gate');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('generated stubs compile under strict tsconfig', () => {
  const tscCandidates = [
    join(HERE, '..', '..', 'node_modules', '.bin', 'tsc'),
    join(process.cwd(), 'node_modules', '.bin', 'tsc'),
  ];
  const tsc = tscCandidates.find((p) => { try { return spawnSync(p, ['--version']).status === 0; } catch { return false; } });
  if (!tsc) { console.log('  (skipped: tsc not found — run after npm install)'); return; }

  const out = mkdtempSync(join(tmpdir(), 'bs-tc-'));
  try {
    generate(SAMPLE, join(out, 'contracts'), true);
    writeFileSync(join(out, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2021', module: 'ESNext', moduleResolution: 'bundler',
        lib: ['ES2021', 'DOM', 'DOM.Iterable'], strict: true,
        noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true,
        isolatedModules: true, verbatimModuleSyntax: true, useDefineForClassFields: true,
        skipLibCheck: true, noEmit: true,
      },
      include: ['contracts'],
    }));
    const r = spawnSync(tsc, ['-p', join(out, 'tsconfig.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `tsc failed:\n${r.stdout}\n${r.stderr}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
