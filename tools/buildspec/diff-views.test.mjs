/* diff-views.test.mjs — integration test for the 4 view renderers.
   Parses a real before-mmd, applies a known edit, diffs, then runs each
   view renderer against a minimal DOM shim and asserts the output.
   Run via: node tools/buildspec/run-bundled-test.mjs tools/buildspec/diff-views.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMermaid } from '../../src/io/mermaid.ts';
import { diffModels } from '../../src/core/diff/diff.ts';
import { renderList } from '../../src/panel/diff-views/list.ts';
import { renderSplit } from '../../src/panel/diff-views/split.ts';
import { renderImpact } from '../../src/panel/diff-views/impact.ts';
import { renderOverlay } from '../../src/panel/diff-views/overlay.ts';

/* ---- minimal DOM shim (only what the renderers touch) ---- */
class El {
  constructor(tag, ns) { this.tag = tag; this.ns = ns; this.children = []; this.attrs = {}; this._cls = ''; this._text = ''; }
  set className(v) { this._cls = v; } get className() { return this._cls; }
  set textContent(v) { this._text = String(v); this.children = []; } get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; this.children = []; this._text = ''; } get innerHTML() { return this._html ?? ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  get style() { return this._style ?? (this._style = {}); }
  appendChild(c) { this.children.push(c); return c; }
  set onclick(f) { this._onclick = f; }
  addEventListener() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { width: 800, height: 400, left: 0, top: 0 }; }
  get classList() { return this._cl ?? (this._cl = { add(){}, remove(){}, toggle(){}, contains(){ return false; } }); }
  querySelector() { return new El('span'); }
  querySelectorAll() { return []; }
  // serialize subtree to a text blob for assertions
  dump() {
    let s = `<${this.tag} class="${this._cls}">`;
    if (this._html) s += this._html;
    if (this._text) s += this._text;
    for (const c of this.children) s += c.dump ? c.dump() : '';
    return s + `</${this.tag}>`;
  }
  allClasses() {
    let set = [this._cls, this.attrs.class ?? ''];
    for (const c of this.children) if (c.allClasses) set = set.concat(c.allClasses());
    return set;
  }
}
globalThis.document = {
  createElement: (t) => new El(t),
  createElementNS: (ns, t) => new El(t, ns),
};

const BEFORE = `flowchart LR
%% fm A 0 0 160 56 rect null
%% fm B 300 0 160 56 round null
%% fm C 600 0 160 56 rect null
%% kind A module
  A["Alpha"]
  B("Beta")
  C["Gamma"]
  A --> B
  B --> C
`;
// edit: rename Alpha->Alpha2, drop C and its edge, add D + edge B->D
const AFTER = `flowchart LR
%% fm A 0 0 160 56 rect null
%% fm B 300 0 160 56 round null
%% fm D 600 200 160 56 rect null
%% kind A module
  A["Alpha2"]
  B("Beta")
  D["Delta"]
  A --> B
  B --> D
`;

const before = fromMermaid(BEFORE);
const after = fromMermaid(AFTER);
const diff = diffModels(before, after);
const arg = { diff, before, after, beforeText: BEFORE, afterText: AFTER };

test('diff sanity for the fixture', () => {
  assert.deepEqual(diff.addedNodes, ['D']);
  assert.deepEqual(diff.removedNodes, ['C']);
  assert.ok(diff.changedNodes.some((c) => c.id === 'A' && c.field === 'label'));
  assert.ok(diff.addedEdges.some((k) => k.startsWith('B->D')));
  assert.ok(diff.removedEdges.some((k) => k.startsWith('B->C')));
});

test('list view shows added/removed/changed + edges', () => {
  const host = new El('div');
  renderList(host, arg);
  const out = host.dump();
  assert.match(out, /\+ D/, 'added node D');
  assert.match(out, /− C/, 'removed node C');
  assert.match(out, /~ A/, 'changed node A');
  assert.match(out, /Alpha2/, 'new label shown');
  assert.match(out, /B →\|solid\| D/, 'added edge shown');
});

test('split view marks add + rem lines', () => {
  const host = new El('div');
  renderSplit(host, arg);
  const classes = host.allClasses().join(' ');
  assert.match(classes, /dv-line add/, 'has add line');
  assert.match(classes, /dv-line rem/, 'has rem line');
});

test('impact view ranks touched nodes', () => {
  const host = new El('div');
  renderImpact(host, arg);
  const out = host.dump();
  assert.match(out, /B/, 'B impacted (edge moved)');
  assert.match(out, /D/, 'D impacted (new)');
  assert.match(out, /C/, 'C impacted (gone)');
});

test('overlay view emits svg nodes with status classes', () => {
  const host = new El('div');
  renderOverlay(host, arg);
  const classes = host.allClasses().join(' ');
  assert.match(classes, /dv-ovl-node add/, 'added node drawn');
  assert.match(classes, /dv-ovl-node rem/, 'removed node drawn');
  assert.match(classes, /dv-ovl-node chg/, 'changed node drawn');
});

test('identical models render empty-state in every view', () => {
  const same = diffModels(before, before);
  const a2 = { diff: same, before, after: before, beforeText: BEFORE, afterText: BEFORE };
  for (const r of [renderList, renderImpact, renderOverlay]) {
    const host = new El('div');
    r(host, a2);
    assert.match(host.dump(), /No changes|identical|nothing/i, `${r.name} shows empty state`);
  }
});
