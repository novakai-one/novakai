/* =====================================================================
   planner.ts — build-plan review surface (full-screen overlay)
   ---------------------------------------------------------------------
   Responsibility: render ctx.plan (a sidecar overlay of proposed changes)
   ON TOP of the real diagram in ctx.state, as a reviewable architectural
   diff. Status colours on real nodes/edges, an intent panel, a per-change
   diff list, accept/reject with dependency-coherence checks, a phase
   filter, blast-radius, and a gated export.

   Isolation by design (see the HANDOFF discussion):
     - Builds its OWN overlay DOM + injects its OWN CSS here. The only
       edits outside this file are one toolbar button in index.html and
       two lines in main.ts. Delete those three things and the feature
       is gone.
     - Owns its OWN SVG world <g> (single-transform pan/zoom) — it never
       touches render.ts / the live canvas.
     - Reads ctx.state + ctx.plan. Writes NOTHING to the model. Verdicts
       live in this module's closure (a prototype review session).

   The plan is metadata keyed on real ids; new capabilities are synthesised
   into the view only. Edges are first-class: an edge change targets an
   edgeKey "from->to:style" and never appears in the .mmd.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import type { DiagramNode } from '../../core/types/types';
import type { MermaidApi } from '../../io/mermaid';
import { fromMermaid } from '../../io/mermaid';
import { childIdsOf } from '../../core/state/state';
import {
  normalizePlan, indexByRef, indexById, synthNode, planFromDiff,
  type Plan, type PlanChange, type Verdict,
} from '../../core/plan/plan';
import { initPlannerDiagram } from './planner-diagram';
import { initPlannerInfo, PLANNER_CSS } from './planner-info';

export interface PlannerApi {
  open: () => void;
  /** open the unified review surface in raw-proposal mode (paste an after .mmd) */
  openProposal: () => void;
  close: () => void;
}

/* Shared closure env — planner.ts is one big factory whose helpers all closed over
   initPlanner's locals. The canvas helpers now live in planner-diagram.ts and the
   side-panel/verdict helpers in planner-info.ts; both are handed this `E` object so
   they still reach the shared session state + siblings. Scalars reassigned across a
   file boundary are read/written as E.field everywhere (here and in the siblings) so
   every holder sees the same value; each sibling attaches its own functions back onto
   E. Mirrors unfold.ts's UEnv pattern. */
export interface PEnv {
  ctx: AppContext;
  $: (id: string) => HTMLElement;
  el: (tag: string) => SVGElement;

  // session state (reassigned across sibling boundaries — must be E.field everywhere)
  plan: Plan;
  byRef: Record<string, PlanChange>;
  byId: Record<string, PlanChange>;
  synth: Record<string, DiagramNode>;   // synthesised add-nodes (view only)
  verdicts: Record<string, Verdict | undefined>;
  level: string | null;                 // null = top, else unit id
  sel: string | null;                   // node id or edgeKey
  planOn: boolean;
  phaseFocus: number | null;
  posCache: Record<string, Record<string, { x: number; y: number }>>;
  k: number; tx: number; ty: number;

  // shared helpers (planner.ts)
  node: (id: string) => DiagramNode | undefined;
  levelNodes: () => string[];
  esc: (str: string) => string;

  // planner-diagram.ts
  applyT: () => void;
  fit: () => void;
  render: () => void;
  toTop: () => void;

  // planner-info.ts
  select: (ref: string | null) => void;
  renderInfo: () => void;
  renderDif: () => void;
  renderPhases: () => void;
  renderLegend: () => void;
  updateProgress: () => void;
  togglePlan: () => void;
  doExport: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// One-time-injected overlay DOM + stylesheet. Pure markup/data — not "logic", so it
// lives at module scope rather than inside a helper function (keeps every function
// under the line/statement caps without artificially chunking the template).
const OVERLAY_HTML = `
  <div class="pl-hd">
    <div class="pl-brand"><b>flow</b>map · planner</div>
    <div class="pl-load">
      <label class="pl-btn" title="Load the base architecture map (.mmd)">Load .mmd
        <input id="plBaseFile" type="file" accept=".mmd,.txt" hidden></label>
      <button class="pl-btn" id="plBasePaste" title="Paste base map text">Paste base</button>
      <label class="pl-btn" title="Load a plan patch (.json)">Load plan
        <input id="plPlanFile" type="file" accept=".json,application/json" hidden></label>
      <button class="pl-btn" id="plPlanPaste" title="Paste plan JSON">Paste plan</button>
      <button class="pl-btn" id="plProposalPaste"
        title="Paste a proposed .mmd — diffed vs the current diagram into a reviewable plan">Diff proposal</button>
      <button class="pl-btn" id="plSample" title="Load the bundled sample plan">Sample</button>
    </div>
    <div class="pl-meta" id="plMeta"></div>
    <div class="pl-tg">
      <div class="pl-switch on" id="plSwitch">● plan overlay</div>
      <span class="pl-meta" id="plProg"></span>
      <div class="pl-pbar"><div class="pl-pfill" id="plFill"></div></div>
      <button class="pl-btn go" id="plExport">Export accepted → spec</button>
      <button class="pl-btn" id="plClose">Close</button>
    </div>
  </div>
  <div class="pl-phases" id="plPhases"></div>
  <div class="pl-canvaswrap" id="plCanvas">
    <svg class="pl-svg" id="plSvg"><g id="plWorld"><g id="plEdges"></g><g id="plNodes"></g></g></svg>
    <div class="pl-crumb" id="plCrumb"></div>
    <div class="pl-warn" id="plWarnBanner" style="display:none"></div>
    <div class="pl-hint">scroll/drag pan · ⌘-scroll zoom · double-click a module to drill in</div>
    <div class="pl-legend" id="plLegend"></div>
    <div class="pl-emptystate" id="plEmpty" style="display:none">
      <h3 id="plEmptyTitle">No base map loaded</h3>
      <div class="pl-meta" id="plEmptyMsg" style="max-width:420px;line-height:1.6"></div>
      <div class="row" id="plEmptyActions"></div>
    </div>
    <div class="pl-paste" id="plPaste" style="display:none">
      <div class="pl-paste-hd"><span id="plPasteTitle">Paste</span><span class="sub" id="plPasteSub"></span>
        <button class="pl-btn" id="plPasteClose">✕ cancel</button></div>
      <textarea id="plPasteTa" spellcheck="false" placeholder="paste here…"></textarea>
      <div class="pl-paste-err" id="plPasteErr"></div>
      <div><button class="pl-btn go" id="plPasteParse">Load</button></div>
    </div>
  </div>
  <div class="pl-rail">
    <div class="pl-info" id="plInfo"></div>
    <div class="pl-difhd">▾ architectural diff · plan vs <b style="color:#8b93a7" id="plBase">base</b></div>
    <div class="pl-dif" id="plDif"></div>
  </div>
  <div class="pl-verify">
    <div class="pl-step done" id="plS1"><span class="dot"></span>author plan</div><span class="pl-arrow">→</span>
    <div class="pl-step active" id="plS2"><span class="dot"></span>review &amp; accept</div>
    <span class="pl-arrow">→</span>
    <div class="pl-step" id="plS3"><span class="dot"></span>export to buildspec</div><span class="pl-arrow">→</span>
    <div class="pl-step" id="plS4"><span class="dot"></span>gate: built code matches plan</div>
    <div class="pl-vmsg" id="plVmsg"></div>
  </div>`;

const EMPTY_STATE_MSG =
  'A plan is reviewed against your architecture map. Load the repo’s <b>.mmd</b> (your full map, e.g. ' +
  '<b>docs/novakai/_bundle.mmd</b>) — the AI’s plan patch then overlays on it. The plan itself is a small ' +
  'JSON of changes, loaded separately.';
const EMPTY_STATE_ACTIONS_HTML =
  '<button class="pl-btn go" id="plEmptyBase">Load .mmd…</button>' +
  '<button class="pl-btn" id="plEmptyBasePaste">Paste base map</button>';

const PASTE_TITLE = {
  base: 'Paste base map (.mmd)', plan: 'Paste plan patch (.json)', proposal: 'Paste proposal map (.mmd)',
};
const PASTE_SUB = {
  base: 'your full architecture map text',
  plan: 'the small JSON of proposed changes',
  proposal: 'the proposed after-map — diffed vs the current diagram into a reviewable plan',
};
const NO_NODES_MSG = 'No nodes parsed — is this valid Mermaid flowchart text?';

/* =================== tiny module-scope helpers =================== */

function queryEl(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function createSvgEl(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag) as SVGElement;
}
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* =================== env construction =================== */

function initEnvSession(env: PEnv): void {
  env.plan = { base: '', changes: [] };
  env.byRef = {};
  env.byId = {};
  env.synth = {};
  env.verdicts = {};
  env.level = null;
  env.sel = null;
}

function initEnvView(env: PEnv): void {
  env.planOn = true;
  env.phaseFocus = null;
  env.posCache = {};
  env.k = 1;
  env['tx'] = 0;
  env['ty'] = 0;
}

function lookupNode(env: PEnv, id: string): DiagramNode | undefined {
  return env.ctx.state.nodes[id] ?? env.synth[id];
}

function isSynthChild(env: PEnv, id: string, container: string | null): boolean {
  const syn = env.synth[id];
  return !!syn && (syn.parent ?? null) === container;
}

/* ---- which nodes live at the current level ---- */
function computeLevelNodes(env: PEnv): string[] {
  const real = childIdsOf(env.ctx.state, env.level).filter((id) => env.ctx.state.nodes[id].shape !== 'group');
  const syn = Object.keys(env.synth).filter((id) => isSynthChild(env, id, env.level));
  return [...real, ...syn];
}

function makeEnv(ctx: AppContext): PEnv {
  const env = {} as PEnv;
  env.ctx = ctx;
  env['$'] = queryEl;
  env.el = createSvgEl;
  initEnvSession(env);
  initEnvView(env);
  env.node = (id) => lookupNode(env, id);
  env.levelNodes = () => computeLevelNodes(env);
  env.esc = escapeHtml;
  return env;
}

/* ---- one-time-injected overlay DOM + stylesheet ---- */

function injectPlannerStyles(): void {
  if (document.getElementById('planner-styles')) return;
  const style = document.createElement('style');
  style.id = 'planner-styles';
  style.textContent = PLANNER_CSS;
  document.head.appendChild(style);
}

function createOverlayEl(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'pl-overlay';
  overlay.id = 'plannerOverlay';
  overlay.innerHTML = OVERLAY_HTML;
  document.body.appendChild(overlay);
  return overlay;
}

/* =================== build view model =================== */

function computeSynthNodes(env: PEnv): void {
  env.synth = {};
  for (const chg of env.plan.changes) {
    const made = synthNode(chg);
    if (made && !env.ctx.state.nodes[made.id]) env.synth[made.id] = made;
  }
}

function clearVerdicts(env: PEnv): void {
  for (const key in env.verdicts) delete env.verdicts[key];
}

function buildViewModel(env: PEnv): void {
  env.byRef = indexByRef(env.plan);
  env.byId = indexById(env.plan);
  computeSynthNodes(env);
  env.posCache = {};
  env.level = null;
  env.sel = null;
  env.phaseFocus = null;
  clearVerdicts(env);
}

/* =================== recompute + empty-state after a load =================== */

function updateMeta(env: PEnv): void {
  const total = Object.keys(env.ctx.state.nodes).length;
  const resolved = env.plan.changes
    .filter((chg) => chg.target.kind === 'node' && env.ctx.state.nodes[chg.target.ref]).length;
  const modified = env.plan.changes.filter((chg) => chg.status === 'modify').length;
  const added = env.plan.changes.filter((chg) => chg.status === 'add').length;
  env.$('plMeta').innerHTML =
    `base <b>${escapeHtml(env.plan.base || '—')}</b> · map <b>${total}</b> nodes · ` +
    `plan <b>${env.plan.changes.length}</b> changes · <b>${modified}</b> modify · ` +
    `<b>${added}</b> new · ${resolved} resolved`;
  env.$('plBase').textContent = env.plan.base || '—';
}

/** Show a guided empty state when there's no base map (nothing to review against). */
function updateEmptyState(env: PEnv): void {
  const noBase = Object.keys(env.ctx.state.nodes).length === 0;
  const box = env.$('plEmpty');
  if (!noBase) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'flex';
  env.$('plEmptyTitle').textContent = 'No base map loaded';
  env.$('plEmptyMsg').innerHTML = EMPTY_STATE_MSG;
  env.$('plEmptyActions').innerHTML = EMPTY_STATE_ACTIONS_HTML;
  (env.$('plEmptyBase')).onclick = () => (env.$('plBaseFile') as HTMLInputElement).click();
  (env.$('plEmptyBasePaste')).onclick = () => openPastePanel(env, 'base');
}

/** Recompute everything after a load (base or plan). Resets the review session. */
function refresh(env: PEnv): void {
  buildViewModel(env);
  updateMeta(env);
  env.renderPhases();
  env.renderLegend();
  env.fit();
  env.render();
  env.renderDif();
  env.renderInfo();
  env.updateProgress();
  updateEmptyState(env);
}

/* =================== loading: base map + plan patch =================== */

/** Load a base map from .mmd text through the canonical mermaid apply path. */
function loadBaseFromText(env: PEnv, deps: { mermaid: MermaidApi }, text: string): boolean {
  const before = Object.keys(env.ctx.state.nodes).length;
  env.ctx.dom.mmd.value = text;
  deps.mermaid.applyText();              // parses, writes ctx.state, renders main canvas, syncs, history
  const after = Object.keys(env.ctx.state.nodes).length;
  const parsed = !!text.trim() && after > 0 && (after !== before || before === 0);
  if (parsed) refresh(env);
  return parsed;
}

/** Load a plan patch from JSON text. Throws on invalid JSON (caller shows the error). */
function loadPlanFromText(env: PEnv, text: string): void {
  const parsed = normalizePlan(JSON.parse(text));
  env.ctx.plan = parsed;
  env.plan = parsed;
  refresh(env);
}

function parseProposalMermaid(text: string): ReturnType<typeof fromMermaid> | null {
  try {
    const after = fromMermaid(text);
    return Object.keys(after.nodes).length ? after : null;
  } catch {
    return null;
  }
}

/**
 * D2 — unified review: ingest a raw proposal `.mmd` (the after map), diff it
 * against the current diagram, and review the derived plan here — the same
 * surface, accept/reject/blast-radius/export. Returns false if nothing parsed.
 */
function loadProposalFromText(env: PEnv, text: string): boolean {
  const after = parseProposalMermaid(text);
  if (!after) return false;
  const before = { nodes: env.ctx.state.nodes, edges: env.ctx.state.edges };
  const derived = planFromDiff(before, { nodes: after.nodes, edges: after.edges }, 'pasted proposal');
  env.ctx.plan = derived;
  env.plan = derived;
  refresh(env);
  return true;
}

async function loadSample(env: PEnv): Promise<void> {
  try {
    const resp = await fetch('plan.json');
    if (!resp.ok) {
      env.ctx.hooks.toast('No sample plan.json found');
      return;
    }
    env.ctx.plan = normalizePlan(await resp.json());
    env.plan = env.ctx.plan;
    refresh(env);
    env.ctx.hooks.toast('Loaded sample plan');
  } catch {
    env.ctx.hooks.toast('Could not load sample plan');
  }
}

/* =================== paste panel =================== */
/* Which of base/plan/proposal is being pasted lives on the panel's own dataset
   rather than a module-level variable — one less piece of shared mutable state. */

function openPastePanel(env: PEnv, mode: 'base' | 'plan' | 'proposal'): void {
  const panel = env.$('plPaste');
  panel.dataset.mode = mode;
  env.$('plPasteTitle').textContent = PASTE_TITLE[mode];
  env.$('plPasteSub').textContent = PASTE_SUB[mode];
  (env.$('plPasteTa') as HTMLTextAreaElement).value = '';
  env.$('plPasteErr').textContent = '';
  panel.style.display = 'flex';
  (env.$('plPasteTa') as HTMLTextAreaElement).focus();
}

function closePastePanel(env: PEnv): void {
  env.$('plPaste').style.display = 'none';
}

function parsePastedBase(env: PEnv, deps: { mermaid: MermaidApi }, text: string): void {
  if (loadBaseFromText(env, deps, text)) {
    closePastePanel(env);
    return;
  }
  env.$('plPasteErr').textContent = NO_NODES_MSG;
}

function parsePastedProposal(env: PEnv, text: string): void {
  if (loadProposalFromText(env, text)) {
    closePastePanel(env);
    return;
  }
  env.$('plPasteErr').textContent = NO_NODES_MSG;
}

function parsePastedPlan(env: PEnv, text: string): void {
  try {
    loadPlanFromText(env, text);
    closePastePanel(env);
  } catch (err) {
    env.$('plPasteErr').textContent = 'Invalid plan JSON: ' + errMessage(err);
  }
}

function parsePastedText(env: PEnv, deps: { mermaid: MermaidApi }): void {
  const mode = env.$('plPaste').dataset.mode as 'base' | 'plan' | 'proposal';
  const text = (env.$('plPasteTa') as HTMLTextAreaElement).value;
  if (!text.trim()) {
    env.$('plPasteErr').textContent = 'Nothing pasted.';
    return;
  }
  if (mode === 'base') {
    parsePastedBase(env, deps, text);
    return;
  }
  if (mode === 'proposal') {
    parsePastedProposal(env, text);
    return;
  }
  parsePastedPlan(env, text);
}

/* =================== open / close =================== */

function openPlanner(env: PEnv, overlay: HTMLElement): void {
  if (env.ctx.plan) env.plan = env.ctx.plan;
  env.ctx.runtime.plannerVisible = true;
  overlay.classList.add('show');
  overlay.focus();
  refresh(env);
}

/** D2 — open the unified surface to review a raw proposal .mmd (diff vs current). */
function openPlannerProposal(env: PEnv, overlay: HTMLElement): void {
  openPlanner(env, overlay);
  openPastePanel(env, 'proposal');
}

function closePlanner(env: PEnv, overlay: HTMLElement): void {
  overlay.classList.remove('show');
  env.ctx.runtime.plannerVisible = false;
  env.ctx.hooks.plannerClosed();
}

/* =================== wire DOM: buttons + file loaders =================== */

function wireStaticButtons(env: PEnv, overlay: HTMLElement): void {
  env.$('plClose').onclick = () => closePlanner(env, overlay);
  env.$('plExport').onclick = env.doExport;
  env.$('plSwitch').onclick = env.togglePlan;
}

function applyBaseFileText(env: PEnv, deps: { mermaid: MermaidApi }, txt: string): void {
  const loaded = loadBaseFromText(env, deps, txt);
  env.ctx.hooks.toast(loaded ? 'Base map loaded' : NO_NODES_MSG);
}

function handleBaseFile(evt: Event, env: PEnv, deps: { mermaid: MermaidApi }): void {
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  file.text().then((txt) => applyBaseFileText(env, deps, txt));
  input.value = '';
}

function applyPlanFileText(env: PEnv, txt: string): void {
  try {
    loadPlanFromText(env, txt);
    env.ctx.hooks.toast('Plan loaded');
  } catch (err) {
    env.ctx.hooks.toast('Invalid plan JSON: ' + errMessage(err));
  }
}

function handlePlanFile(evt: Event, env: PEnv): void {
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  file.text().then((txt) => applyPlanFileText(env, txt));
  input.value = '';
}

function wireLoaders(env: PEnv, deps: { mermaid: MermaidApi }): void {
  (env.$('plBaseFile') as HTMLInputElement).onchange = (evt) => handleBaseFile(evt, env, deps);
  (env.$('plPlanFile') as HTMLInputElement).onchange = (evt) => handlePlanFile(evt, env);
  env.$('plBasePaste').onclick = () => openPastePanel(env, 'base');
  env.$('plPlanPaste').onclick = () => openPastePanel(env, 'plan');
  env.$('plProposalPaste').onclick = () => openPastePanel(env, 'proposal');
  env.$('plSample').onclick = () => {
    void loadSample(env);
  };
  env.$('plPasteClose').onclick = () => closePastePanel(env);
  env.$('plPasteParse').onclick = () => parsePastedText(env, deps);
}

/* =================== wire DOM: pan / zoom =================== */

interface PanState { dragging: boolean; startX: number; startY: number; origX: number; origY: number; moved: boolean; }

function onPanStart(evt: MouseEvent, env: PEnv, wrap: HTMLElement, pan: PanState): void {
  if ((evt.target as HTMLElement).closest('.pl-nodeg')) return;
  pan.dragging = true;
  pan.moved = false;
  pan.startX = evt.clientX;
  pan.startY = evt.clientY;
  pan.origX = env.tx;
  pan.origY = env.ty;
  wrap.classList.add('pan');
}

function onPanMove(evt: MouseEvent, env: PEnv, pan: PanState): void {
  if (!pan.dragging) return;
  env['tx'] = pan.origX + (evt.clientX - pan.startX);
  env['ty'] = pan.origY + (evt.clientY - pan.startY);
  if (Math.abs(evt.clientX - pan.startX) + Math.abs(evt.clientY - pan.startY) > 3) pan.moved = true;
  env.applyT();
}

function onPanEnd(wrap: HTMLElement, pan: PanState): void {
  pan.dragging = false;
  wrap.classList.remove('pan');
}

function onPanClick(evt: MouseEvent, env: PEnv, pan: PanState): void {
  if ((evt.target as HTMLElement).closest('.pl-nodeg')) return;
  if (pan.moved) return;
  env.select(null);
}

function zoomAt(env: PEnv, evt: WheelEvent, mouseX: number, mouseY: number): void {
  const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
  const worldX = (mouseX - env.tx) / env.k;
  const worldY = (mouseY - env.ty) / env.k;
  env.k = Math.max(0.2, Math.min(2.4, env.k * factor));
  env['tx'] = mouseX - worldX * env.k;
  env['ty'] = mouseY - worldY * env.k;
  env.applyT();
}

function onWheel(evt: WheelEvent, env: PEnv, wrap: HTMLElement): void {
  evt.preventDefault();
  const bbox = wrap.getBoundingClientRect();
  const mouseX = evt.clientX - bbox.left;
  const mouseY = evt.clientY - bbox.top;
  if (evt.ctrlKey || evt.metaKey) {
    zoomAt(env, evt, mouseX, mouseY);
    return;
  }
  env['tx'] -= evt.deltaX;
  env['ty'] -= evt.deltaY;
  env.applyT();
}

function onOverlayKeydown(evt: KeyboardEvent, env: PEnv, overlay: HTMLElement): void {
  if (evt.key !== 'Escape') return;
  if (env.level !== null) {
    env.toTop();
    return;
  }
  closePlanner(env, overlay);
}

function onResize(env: PEnv, overlay: HTMLElement): void {
  if (overlay.classList.contains('show')) env.fit();
}

function wirePanZoom(env: PEnv, overlay: HTMLElement): void {
  const wrap = env.$('plCanvas');
  const pan: PanState = { dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false };
  wrap.addEventListener('mousedown', (evt) => onPanStart(evt, env, wrap, pan));
  window.addEventListener('mousemove', (evt) => onPanMove(evt, env, pan));
  window.addEventListener('mouseup', () => onPanEnd(wrap, pan));
  wrap.addEventListener('click', (evt) => onPanClick(evt, env, pan));
  env.$('plSvg').addEventListener('wheel', (evt) => onWheel(evt as WheelEvent, env, wrap), { passive: false });
  overlay.addEventListener('keydown', (evt) => onOverlayKeydown(evt, env, overlay));
  overlay.tabIndex = -1;
  window.addEventListener('resize', () => onResize(env, overlay));
}

// Build the planner overlay (DOM + CSS + session state) and return its open/openProposal/close API.
export function initPlanner(ctx: AppContext, deps: { mermaid: MermaidApi }): PlannerApi {
  injectPlannerStyles();
  const overlay = createOverlayEl();
  const env = makeEnv(ctx);

  initPlannerDiagram(env);
  initPlannerInfo(env);

  wireStaticButtons(env, overlay);
  wireLoaders(env, deps);
  wirePanZoom(env, overlay);

  return {
    open: () => openPlanner(env, overlay),
    openProposal: () => openPlannerProposal(env, overlay),
    close: () => closePlanner(env, overlay),
  };
}
