/* normtype.test.mjs — unit tests for normType / isCleanType (skeleton.mjs).
   Focused on the A6 additions: object-literal types and function types.
   Run: node --test tools/buildspec/core/normtype.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normType, isCleanType } from './skeleton.mjs';

const NULL_OR_STRING = 'null | string';
const SIMPLE_OBJ_LITERAL = '{ x: number; y: number }';
const RECORD_OF_SIMPLE_OBJ = 'Record<string, { x: number; y: number }>';
const NO_ARG_VOID_FN = '() => void';
const TWO_NUM_ARGS_VOID_FN = '(sx: number, sy: number) => void';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Two types that are structurally equal should normalize to the same string. */
function assertEqual(typeA, typeB, msg) {
  const normA = normType(typeA), normB = normType(typeB);
  assert.notEqual(normA, null, `normType(${typeA}) should not be null`);
  assert.equal(normA, normB, msg ?? `${typeA} === ${typeB}`);
}

/** A type that is prose (non-gatable) should return null. */
function assertProse(type) {
  assert.equal(normType(type), null, `expected normType(${type}) === null (prose)`);
}

// ── pre-existing behaviour (must not regress) ─────────────────────────────────

test('primitives and PascalCase types remain clean', () => {
  assert.equal(normType('string'), 'string');
  assert.equal(normType('number'), 'number');
  assert.equal(normType('boolean'), 'boolean');
  assert.equal(normType('void'), 'void');
  assert.equal(normType('NodeMap'), 'NodeMap');
  assert.equal(normType('DiagramEdge[]'), 'DiagramEdge[]');
});

test('lowercase non-primitive words are prose', () => {
  assertProse('mouse');
  assertProse('refs');
});

test('union sorting — simple types', () => {
  assert.equal(normType('B | A'), 'A | B');
  assert.equal(normType(NULL_OR_STRING), NULL_OR_STRING); // already sorted
  assert.equal(normType('string | null'), NULL_OR_STRING); // sorts to same
  assert.equal(normType('string | null | undefined'), NULL_OR_STRING); // drops undefined
});

test('lib generics normalize args', () => {
  assert.equal(normType('Record<string, number>'), 'Record<string, number>');
  assert.equal(normType('Set<string>'), 'Set<string>');
  assert.equal(normType('Promise<void>'), 'Promise<void>');
});

// ── A6: object-literal types ──────────────────────────────────────────────────

test('simple object literal — isCleanType returns true', () => {
  assert.equal(isCleanType(SIMPLE_OBJ_LITERAL), true);
  assert.equal(isCleanType('{}'), true);
});

test('object literal — whitespace variants produce the same normalized form', () => {
  assertEqual(SIMPLE_OBJ_LITERAL, '{x:number;y:number}');
  assertEqual(SIMPLE_OBJ_LITERAL, '{ x:  number ;  y:  number }');
});

test('object literal — members are sorted by key name', () => {
  assertEqual('{ y: number; x: number }', SIMPLE_OBJ_LITERAL);
  assertEqual(
    '{ minY: number; minX: number; maxY: number; maxX: number }',
    '{ maxX: number; maxY: number; minX: number; minY: number }',
  );
});

test('object literal — canonical form uses sorted keys', () => {
  assert.equal(normType('{ y: number; x: number }'), SIMPLE_OBJ_LITERAL);
});

test('object literal — optional properties (key?) are accepted', () => {
  assert.equal(normType('{ only?: Set<string> }'), '{ only?: Set<string> }');
  assert.equal(normType('{ roots?: string[]; maxDepth?: number }'),
    '{ maxDepth?: number; roots?: string[] }');
});

test('object literal — values may be unions', () => {
  // |  inside {} should not be treated as a top-level union separator
  assert.equal(
    normType('{ color: string | null; kind?: NodeKind | null }'),
    '{ color: null | string; kind?: NodeKind | null }',
  );
});

test('object literal — values may be generics', () => {
  assert.equal(
    normType('{ nodes: Record<string, DiagramNode>; edges: DiagramEdge[] }'),
    '{ edges: DiagramEdge[]; nodes: Record<string, DiagramNode> }',
  );
});

test('object literal — array of objects', () => {
  assert.equal(
    normType('{ id: string; poly: Point[] }[]'),
    '{ id: string; poly: Point[] }[]',
  );
});

test('object literal — nested inside generic (e.g. Record<string, {…}>)', () => {
  assert.equal(
    normType(RECORD_OF_SIMPLE_OBJ),
    RECORD_OF_SIMPLE_OBJ,
  );
  // order-independent inside the generic arg too
  assertEqual(
    'Record<string, { y: number; x: number }>',
    RECORD_OF_SIMPLE_OBJ,
  );
});

test('object literal — union with null at top level', () => {
  assertEqual(
    '{ id: string; key: string } | null',
    '{ key: string; id: string } | null',
  );
});

// ── A6: function types ────────────────────────────────────────────────────────

test('function types — isCleanType returns true', () => {
  assert.equal(isCleanType(NO_ARG_VOID_FN), true);
  assert.equal(isCleanType('(id: string) => boolean'), true);
  assert.equal(isCleanType(TWO_NUM_ARGS_VOID_FN), true);
});

test('function types — no-arg function', () => {
  assert.equal(normType(NO_ARG_VOID_FN), NO_ARG_VOID_FN);
});

test('function types — param name + type kept, whitespace collapsed', () => {
  assert.equal(normType('(changeId: string) => boolean'), '(changeId: string) => boolean');
  assert.equal(normType('( id : string ) => boolean'), '(id: string) => boolean');
});

test('function types — multiple params', () => {
  assert.equal(
    normType(TWO_NUM_ARGS_VOID_FN),
    TWO_NUM_ARGS_VOID_FN,
  );
});

test('function types — return type normalized', () => {
  assert.equal(
    normType('(movedIds: Set<string>) => void'),
    '(movedIds: Set<string>) => void',
  );
});

test('function types — object as return type', () => {
  assert.equal(
    normType('(id: string) => { x: number; y: number }'),
    '(id: string) => { x: number; y: number }',
  );
});

test('function type as object-literal member value', () => {
  assert.equal(
    normType('{ drawWires: () => void }'),
    '{ drawWires: () => void }',
  );
  // members sorted
  assertEqual(
    '{ updateWiresFor: (ids: Set<string>) => void; drawWires: () => void }',
    '{ drawWires: () => void; updateWiresFor: (ids: Set<string>) => void }',
  );
});

// ── A6: string-literal types ──────────────────────────────────────────────────

test('string-literal union — sorted for order-independence', () => {
  assert.equal(normType("'v' | 'h'"), "'h' | 'v'");
  assertEqual("'insp' | 'style' | 'mmd' | 'source'", "'mmd' | 'source' | 'insp' | 'style'");
});

test('string-literal union — undefined dropped', () => {
  assert.equal(normType("'a' | undefined"), "'a'");
});

// ── prose: types that must remain null ───────────────────────────────────────

test('import() dynamic type is prose', () => {
  assertProse("import('../core/types/types').PortSide");
});

test('object with prose value is prose', () => {
  // 'mouse' is a lowercase non-primitive word in type position
  assertProse('{ x: mouse }');
});
