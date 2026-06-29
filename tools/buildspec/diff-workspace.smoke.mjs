/* diff-workspace.smoke.mjs — drives the WHOLE workspace module against a
   DOM shim: open (snapshot), compare (parse+diff+render), switch all 4
   views, apply (writes proposal to mmd textarea + calls applyText). Proves
   the wiring runs end-to-end without throwing and produces expected effects.
   Run: node tools/buildspec/run-bundled-test.mjs tools/buildspec/diff-workspace.smoke.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDiffWorkspace } from '../../src/panel/diff-workspace.ts';

/* ---- DOM shim ---- */
class El {
  constructor(tag, ns) { this.tag = tag; this.ns = ns; this.children = []; this.attrs = {};
    this._cls = ''; this._text = ''; this._html = ''; this.value = ''; this.dataset = {};
    this.classList = { _s: new Set(),
      add: (c) => this.classList._s.add(c), remove: (c) => this.classList._s.delete(c),
      toggle: (c, on) => { on ? this.classList._s.add(c) : this.classList._s.delete(c); },
      contains: (c) => this.classList._s.has(c) }; }
  set className(v) { this._cls = v; } get className() { return this._cls; }
  set textContent(v) { this._text = String(v); this.children = []; } get textContent() { return this._text; }
  set innerHTML(v) { this._html = v; this.children = []; } get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  get style() { return this._style ?? (this._style = {}); }
  appendChild(c) { this.children.push(c); return c; }
  focus() {}
  set onclick(f) { this._onclick = f; }
  get onclick() { return this._onclick; }
  addEventListener() {}
  querySelector() { return new El('span'); }
  querySelectorAll(sel) { return registry.tabs; }
  getBoundingClientRect() { return { width: 800, height: 300, left: 0, top: 0 }; }
  setPointerCapture() {}
  dump() { let s = this._html + this._text; for (const c of this.children) s += c.dump ? c.dump() : ''; return s; }
}

const registry = { byId: {}, tabs: [] };
const mk = (id) => { const e = new El('div'); e.id = id; registry.byId[id] = e; return e; };
['diffOverlay','diffBefore','diffAfter','diffBeforeMeta','diffCounts','diffBody',
 'diffClose','diffCompare','diffApply','diffPaste','diffTabs','diffMenu','diffMenuBtn','diffResize','diffInputs'].forEach(mk);
// tab buttons
registry.tabs = ['list','split','impact','overlay'].map((v) => {
  const b = new El('button'); b.dataset = { view: v }; return b;
});

globalThis.document = {
  getElementById: (id) => registry.byId[id] ?? null,
  createElement: (t) => new El(t),
  createElementNS: (ns, t) => new El(t, ns),
  querySelectorAll: () => registry.tabs,
  addEventListener: () => {},
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, innerHeight: 900 };
globalThis.confirm = () => globalThis.__confirmReturn ?? true;

/* ---- fake ctx + mermaid ---- */
const CURRENT = `flowchart LR
%% fm A 0 0 160 56 rect null
%% fm B 300 0 160 56 round null
  A["Alpha"]
  B("Beta")
  A --> B
`;
const PROPOSAL = `flowchart LR
%% fm A 0 0 160 56 rect null
%% fm B 300 0 160 56 round null
%% fm C 600 0 160 56 rect null
  A["Alpha2"]
  B("Beta")
  C["Gamma"]
  A --> B
  B --> C
`;

let appliedText = null;
const mmdTextarea = new El('textarea');
const ctx = {
  state: { nodes: { A: {}, B: {} }, edges: [{ id: 'e1' }] },
  dom: { mmd: mmdTextarea },
  hooks: { toast: () => {} },
};
const mermaid = {
  toMermaid: () => CURRENT,
  applyText: () => { appliedText = ctx.dom.mmd.value; },
};

test('open snapshots current model into before box', () => {
  const ws = initDiffWorkspace(ctx, { mermaid });
  ws.open();
  assert.equal(registry.byId.diffBefore.value, CURRENT, 'before = current snapshot');
  assert.ok(registry.byId.diffOverlay.classList.contains('show'), 'overlay shown');
});

test('compare parses + diffs + renders counts', () => {
  initDiffWorkspace(ctx, { mermaid });
  registry.byId.diffBefore.value = CURRENT;
  registry.byId.diffAfter.value = PROPOSAL;
  registry.byId.diffCompare._onclick();   // click Compare
  const counts = registry.byId.diffCounts.innerHTML;
  assert.match(counts, /\+1 nodes/, 'one added node counted');
  assert.match(counts, /\+1 edges/, 'one added edge counted');
  assert.ok(registry.byId.diffBody.dump().length > 0, 'body rendered');
});

test('all 4 view tabs render without throwing', () => {
  initDiffWorkspace(ctx, { mermaid });
  registry.byId.diffBefore.value = CURRENT;
  registry.byId.diffAfter.value = PROPOSAL;
  registry.byId.diffCompare._onclick();
  for (const tab of registry.tabs) {
    assert.doesNotThrow(() => tab._onclick(), `view ${tab.dataset.view}`);
  }
});

test('apply writes proposal to mmd textarea + calls applyText', () => {
  appliedText = null;
  initDiffWorkspace(ctx, { mermaid });
  registry.byId.diffAfter.value = PROPOSAL;
  registry.byId.diffApply._onclick();    // click Apply
  assert.equal(appliedText, PROPOSAL, 'applyText received the proposal');
  assert.equal(ctx.dom.mmd.value, PROPOSAL, 'mmd textarea holds proposal');
});

test('apply with empty proposal does nothing', () => {
  appliedText = null;
  initDiffWorkspace(ctx, { mermaid });
  registry.byId.diffAfter.value = '   ';
  registry.byId.diffApply._onclick();
  assert.equal(appliedText, null, 'no apply on empty');
});
