/* =====================================================================
   core-frontmatter.test.ts — characterization tests for
   src/core/frontmatter/frontmatter.ts
   ---------------------------------------------------------------------
   Covers the serialize/parse round-trip (frontmatterToMermaid ->
   matchFrontmatterLine/applyFrontmatterLine), normalizeFrontmatter,
   isFrontmatterEmpty/pruneFrontmatter, and parseTypeRef. expected values
   are observed behavior, not spec.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFrontmatter, normalizeFrontmatter, isFrontmatterEmpty, pruneFrontmatter,
  frontmatterToMermaid, matchFrontmatterLine, applyFrontmatterLine, parseTypeRef,
} from '../../src/core/frontmatter/frontmatter.ts';
import type { Frontmatter } from '../../src/core/types/types.ts';

// ---------------------------------------------------------------------
// emptiness
// ---------------------------------------------------------------------

test('isFrontmatterEmpty: undefined and a freshly-created empty frontmatter are both empty', () => {
  assert.equal(isFrontmatterEmpty(undefined), true);
  assert.equal(isFrontmatterEmpty(emptyFrontmatter()), true);
});

// ---------------------------------------------------------------------
// serialize -> parse round-trip
// ---------------------------------------------------------------------

test('frontmatterToMermaid + matchFrontmatterLine/applyFrontmatterLine round-trips a full frontmatter', () => {
  const fm: Frontmatter = {
    name: 'Store', description: 'central store', state: ['count: number'],
    interfaces: [{ name: 'dispatch', accepts: ['action: Action'], returns: ['void'] }],
  };
  const mmd = frontmatterToMermaid('n3', fm);
  assert.equal(mmd,
    '%% fm:meta n3 name=Store\n%% fm:meta n3 desc=central store\n%% fm:meta n3 state=count: number\n'
    + '%% fm:meta n3 i0.name=dispatch\n%% fm:meta n3 i0.accepts=action: Action\n%% fm:meta n3 i0.returns=void\n');

  const acc: Record<string, Frontmatter> = {};
  for (const line of mmd.trim().split('\n')) {
    const parsed = matchFrontmatterLine(line);
    assert.notEqual(parsed, null);
    applyFrontmatterLine(acc, parsed!);
  }
  assert.deepEqual(acc.n3, pruneFrontmatter(fm));
});

test('frontmatterToMermaid: a fully empty frontmatter serializes to the empty string', () => {
  assert.equal(frontmatterToMermaid('n1', emptyFrontmatter()), '');
});

test('matchFrontmatterLine: a non-matching line returns null', () => {
  assert.equal(matchFrontmatterLine('some text'), null);
});

test('matchFrontmatterLine: legacy bare "accepts=" (no i<N> prefix) parses as interface 0', () => {
  assert.deepEqual(matchFrontmatterLine('%% fm:meta n1 accepts=foo'), { id: 'n1', key: 'accepts', value: 'foo', iface: 0 });
});

// ---------------------------------------------------------------------
// normalizeFrontmatter
// ---------------------------------------------------------------------

test('normalizeFrontmatter: legacy flat accepts/returns fold into interface 0', () => {
  assert.deepEqual(normalizeFrontmatter({ accepts: ['x'], returns: ['y'] }), {
    name: '', description: '', state: [], interfaces: [{ name: '', accepts: ['x'], returns: ['y'] }],
  });
});

test('normalizeFrontmatter: non-object input -> empty frontmatter', () => {
  assert.deepEqual(normalizeFrontmatter('nope'), emptyFrontmatter());
});

test('normalizeFrontmatter: partial input only sets the fields present', () => {
  assert.deepEqual(normalizeFrontmatter({ name: 'N' }), { name: 'N', description: '', state: [], interfaces: [] });
});

// ---------------------------------------------------------------------
// pruneFrontmatter
// ---------------------------------------------------------------------

test('pruneFrontmatter: drops blank state entries and empty interfaces, trims survivors', () => {
  assert.deepEqual(
    pruneFrontmatter({ name: ' ', description: '', state: ['', ' a '], interfaces: [{ name: '', accepts: [''], returns: [''] }] }),
    { name: '', description: '', state: ['a'], interfaces: [] },
  );
});

// ---------------------------------------------------------------------
// parseTypeRef
// ---------------------------------------------------------------------

test('parseTypeRef: "name: Type" splits into varName + type', () => {
  assert.deepEqual(parseTypeRef('count: number'), { varName: 'count', type: 'number' });
});

test('parseTypeRef: no colon -> varName empty, whole string is the type', () => {
  assert.deepEqual(parseTypeRef('justtype'), { varName: '', type: 'justtype' });
});

test('parseTypeRef: surrounding whitespace on both sides is trimmed', () => {
  assert.deepEqual(parseTypeRef('  x : Y  '), { varName: 'x', type: 'Y' });
});
