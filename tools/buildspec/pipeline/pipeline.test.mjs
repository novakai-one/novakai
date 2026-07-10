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

import { parseMmd, realNodeIds } from '../core/mmd-parse.mjs';
import { specSkeletons } from '../core/skeleton.mjs';
import { diffSkeletons } from '../core/diff-core.mjs';
import { extract } from './extract.mjs';
import { generate } from './spec-to-stubs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', '__fixtures__');
const SAMPLE = join(FIX, 'sample.mmd');
const SAMPLE_SRC = join(FIX, 'sample-src');

// hand-verified expected skeleton for SAMPLE_SRC — the doc-mandated guard
// against silent undercount in the extractor. Hoisted to module scope so
// the test body itself stays under the readability line budget.
const EXPECTED_SAMPLE_SKELETONS = {
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
    members: [
      { name: 'helper', arity: 2, returnsValue: false, paramTypes: ['number', 'number'], returnType: 'void' },
    ],
  },
};

// every drift class the gate must catch, hand-verified against a clean
// clone of the spec skeleton. Hoisted to module scope for the same reason
// as EXPECTED_SAMPLE_SKELETONS above.
const DRIFT_CASES = [
  ['unbuilt', (codeSkeleton) => { delete codeSkeleton.store; }],
  ['unplanned', (codeSkeleton) => {
    codeSkeleton.ghost = { id: 'ghost', kind: 'function', parent: null, members: [] };
  }],
  ['kind mismatch', (codeSkeleton) => { codeSkeleton.validate.kind = 'class'; }],
  ['parent mismatch', (codeSkeleton) => { codeSkeleton.helper.parent = null; }],
  ['missing member', (codeSkeleton) => {
    codeSkeleton.store.members = codeSkeleton.store.members.filter((member) => member.name !== 'get');
  }],
  ['arity mismatch', (codeSkeleton) => { codeSkeleton.helper.members[0].arity = 1; }],
  ['return mismatch', (codeSkeleton) => {
    codeSkeleton.store.members.find((member) => member.name === 'set').returnsValue = true;
  }],
  ['param type mismatch', (codeSkeleton) => { codeSkeleton.helper.members[0].paramTypes[0] = 'string'; }],
  ['return type mismatch', (codeSkeleton) => {
    codeSkeleton.store.members.find((member) => member.name === 'get').returnType = 'string';
  }],
];

function projectFrom(dir) {
  const project = new Project({ compilerOptions: { allowJs: false }, useInMemoryFileSystem: false });
  project.addSourceFilesAtPaths(join(dir, '**/*.ts'));
  return project;
}

function tscWorks(candidate) {
  try {
    return spawnSync(candidate, ['--version']).status === 0;
  } catch {
    return false;
  }
}

/** Locate a usable tsc binary among the repo's node_modules/.bin, or null. */
function resolveTsc() {
  const candidates = [
    join(HERE, '..', '..', '..', 'node_modules', '.bin', 'tsc'),
    join(process.cwd(), 'node_modules', '.bin', 'tsc'),
  ];
  return candidates.find((candidate) => tscWorks(candidate)) || null;
}

/** Drop the second param from a generated stub to force a signature drift. */
function dropHelperParam(out) {
  const helperPath = join(out, 'helper.ts');
  const original = readFileSync(helperPath, 'utf8');
  writeFileSync(helperPath, original.replace('(_a: number, _b: number)', '(_a: number)'));
}

function writeStubTsConfig(dir) {
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2021', module: 'ESNext', moduleResolution: 'bundler',
      lib: ['ES2021', 'DOM', 'DOM.Iterable'], strict: true,
      noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true,
      isolatedModules: true, verbatimModuleSyntax: true, useDefineForClassFields: true,
      skipLibCheck: true, noEmit: true,
    },
    include: ['contracts'],
  }));
}

test('parser reads nodes, kinds and edges', () => {
  const model = parseMmd(readFileSync(SAMPLE, 'utf8'));
  assert.deepEqual(realNodeIds(model).sort(), ['Shape', 'helper', 'store', 'validate']);
  assert.equal(model.nodes.store.kind, 'class');
  assert.equal(model.nodes.Shape.kind, 'type');
  assert.equal(model.edges.length, 1);
  assert.equal(model.roots[0], 'store');
});

test('extractor produces the hand-verified graph (guards silent undercount)', () => {
  const got = specSkeletons(extract(projectFrom(SAMPLE_SRC)));
  assert.deepEqual(got, EXPECTED_SAMPLE_SKELETONS);
});

test('private members are excluded from the skeleton', () => {
  const got = specSkeletons(extract(projectFrom(SAMPLE_SRC)));
  assert.ok(!got.store.members.some((member) => member.name === '_secret'));
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
  for (const [label, mutate] of DRIFT_CASES) {
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
    dropHelperParam(out);
    code = specSkeletons(extract(projectFrom(out)));
    const drifted = diffSkeletons(spec, code).errors;
    assert.ok(drifted.some((e) => e.startsWith('arity mismatch')), 'signature change must fail the gate');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('generated stubs compile under strict tsconfig', () => {
  const tsc = resolveTsc();
  if (!tsc) {
    console.log('  (skipped: tsc not found — run after npm install)');
    return;
  }

  const out = mkdtempSync(join(tmpdir(), 'bs-tc-'));
  try {
    generate(SAMPLE, join(out, 'contracts'), true);
    writeStubTsConfig(out);
    const result = spawnSync(tsc, ['-p', join(out, 'tsconfig.json')], { encoding: 'utf8' });
    assert.equal(result.status, 0, `tsc failed:\n${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
