/* diff-views.test.mjs — integration test for the 4 view renderers.
   Parses a real before-mmd, applies a known edit, diffs, then runs each
   view renderer against a minimal DOM shim and asserts the output.
   Run via: node tools/buildspec/testkit/run-bundled-test.mjs tools/buildspec/testkit/diff-views.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMermaid } from '../../../src/io/mermaid.ts';
import { diffModels } from '../../../src/core/diff/diff.ts';
import { renderList } from '../../../src/panel/diff-views/list.ts';
import { renderSplit } from '../../../src/panel/diff-views/split.ts';
import { renderImpact } from '../../../src/panel/diff-views/impact.ts';
import { renderOverlay } from '../../../src/panel/diff-views/overlay.ts';

/* ---- minimal DOM shim (only what the renderers touch) ---- */
class FakeElement {
  constructor(tag, namespace) {
    this.tag = tag;
    this.namespace = namespace;
    this.children = [];
    this.attrs = {};
    this._cls = '';
    this._text = '';
  }
  set className(value) { this._cls = value; }
  get className() { return this._cls; }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get textContent() { return this._text; }
  set innerHTML(value) {
    this._html = value;
    this.children = [];
    this._text = '';
  }
  get innerHTML() { return this._html ?? ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  get style() { return this._style ?? (this._style = {}); }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  set onclick(handler) { this._onclick = handler; }
  addEventListener() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { width: 800, height: 400, left: 0, top: 0 }; }
  get classList() {
    if (!this._cl) {
      this._cl = {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      };
    }
    return this._cl;
  }
  querySelector() { return new FakeElement('span'); }
  querySelectorAll() { return []; }
  // serialize subtree to a text blob for assertions
  dump() {
    let str = `<${this.tag} class="${this._cls}">`;
    if (this._html) str += this._html;
    if (this._text) str += this._text;
    for (const child of this.children) str += child.dump ? child.dump() : '';
    return str + `</${this.tag}>`;
  }
  allClasses() {
    let classes = [this._cls, this.attrs.class ?? ''];
    for (const child of this.children) if (child.allClasses) classes = classes.concat(child.allClasses());
    return classes;
  }
}
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (namespace, tag) => new FakeElement(tag, namespace),
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
  assert.ok(diff.changedNodes.some((change) => change.id === 'A' && change.field === 'label'));
  assert.ok(diff.addedEdges.some((key) => key.startsWith('B->D')));
  assert.ok(diff.removedEdges.some((key) => key.startsWith('B->C')));
});

test('list view shows added/removed/changed + edges', () => {
  const host = new FakeElement('div');
  renderList(host, arg);
  const out = host.dump();
  assert.match(out, /\+ D/, 'added node D');
  assert.match(out, /− C/, 'removed node C');
  assert.match(out, /~ A/, 'changed node A');
  assert.match(out, /Alpha2/, 'new label shown');
  assert.match(out, /B →\|solid\| D/, 'added edge shown');
});

test('split view marks add + rem lines', () => {
  const host = new FakeElement('div');
  renderSplit(host, arg);
  const classes = host.allClasses().join(' ');
  assert.match(classes, /dv-line add/, 'has add line');
  assert.match(classes, /dv-line rem/, 'has rem line');
});

test('impact view ranks touched nodes', () => {
  const host = new FakeElement('div');
  renderImpact(host, arg);
  const out = host.dump();
  assert.match(out, /B/, 'B impacted (edge moved)');
  assert.match(out, /D/, 'D impacted (new)');
  assert.match(out, /C/, 'C impacted (gone)');
});

test('overlay view emits svg nodes with status classes', () => {
  const host = new FakeElement('div');
  renderOverlay(host, arg);
  const classes = host.allClasses().join(' ');
  assert.match(classes, /dv-ovl-node add/, 'added node drawn');
  assert.match(classes, /dv-ovl-node rem/, 'removed node drawn');
  assert.match(classes, /dv-ovl-node chg/, 'changed node drawn');
});

test('identical models render empty-state in every view', () => {
  const same = diffModels(before, before);
  const argSame = { diff: same, before, after: before, beforeText: BEFORE, afterText: BEFORE };
  for (const renderFn of [renderList, renderImpact, renderOverlay]) {
    const host = new FakeElement('div');
    renderFn(host, argSame);
    assert.match(host.dump(), /No changes|identical|nothing/i, `${renderFn.name} shows empty state`);
  }
});
