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

const NS = 'http://www.w3.org/2000/svg';

// Build the planner overlay (DOM + CSS + session state) and return its open/openProposal/close API.
export function initPlanner(ctx: AppContext, deps: { mermaid: MermaidApi }): PlannerApi {
  /* ---- inject stylesheet once ---- */
  if (!document.getElementById('planner-styles')) {
    const st = document.createElement('style');
    st.id = 'planner-styles';
    st.textContent = PLANNER_CSS;
    document.head.appendChild(st);
  }

  /* ---- build overlay DOM ---- */
  const overlay = document.createElement('div');
  overlay.className = 'pl-overlay';
  overlay.id = 'plannerOverlay';
  overlay.innerHTML = `
    <div class="pl-hd">
      <div class="pl-brand"><b>flow</b>map · planner</div>
      <div class="pl-load">
        <label class="pl-btn" title="Load the base architecture map (.mmd)">Load .mmd<input id="plBaseFile" type="file" accept=".mmd,.txt" hidden></label>
        <button class="pl-btn" id="plBasePaste" title="Paste base map text">Paste base</button>
        <label class="pl-btn" title="Load a plan patch (.json)">Load plan<input id="plPlanFile" type="file" accept=".json,application/json" hidden></label>
        <button class="pl-btn" id="plPlanPaste" title="Paste plan JSON">Paste plan</button>
        <button class="pl-btn" id="plProposalPaste" title="Paste a proposed .mmd — diffed vs the current diagram into a reviewable plan">Diff proposal</button>
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
        <div class="pl-paste-hd"><span id="plPasteTitle">Paste</span><span class="sub" id="plPasteSub"></span><button class="pl-btn" id="plPasteClose">✕ cancel</button></div>
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
      <div class="pl-step active" id="plS2"><span class="dot"></span>review &amp; accept</div><span class="pl-arrow">→</span>
      <div class="pl-step" id="plS3"><span class="dot"></span>export to buildspec</div><span class="pl-arrow">→</span>
      <div class="pl-step" id="plS4"><span class="dot"></span>gate: built code matches plan</div>
      <div class="pl-vmsg" id="plVmsg"></div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const el = (tag: string): SVGElement => document.createElementNS(NS, tag) as SVGElement;

  /* ---- shared session env (see PEnv); canvas → planner-diagram, side-panel → planner-info ---- */
  const E = {} as PEnv;
  E.ctx = ctx;
  E.$ = $;
  E.el = el;
  E.plan = { base: '', changes: [] };
  E.byRef = {};
  E.byId = {};
  E.synth = {};   // synthesised add-nodes (view only)
  E.verdicts = {};
  E.level = null;                 // null = top, else unit id
  E.sel = null;                   // node id or edgeKey
  E.planOn = true;
  E.phaseFocus = null;
  E.posCache = {};
  E.k = 1; E.tx = 0; E.ty = 0;

  /* ---- node lookup across real + synth ---- */
  const node = (id: string): DiagramNode | undefined => ctx.state.nodes[id] ?? E.synth[id];
  const isSynthChild = (id: string, container: string | null): boolean => {
    const syn = E.synth[id];
    return !!syn && (syn.parent ?? null) === container;
  };

  /* ---- which nodes live at the current level ---- */
  function levelNodes(): string[] {
    const real = childIdsOf(ctx.state, E.level).filter((id) => ctx.state.nodes[id].shape !== 'group');
    const syn = Object.keys(E.synth).filter((id) => isSynthChild(id, E.level));
    return [...real, ...syn];
  }

  function esc(str: string): string { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  E.node = node;
  E.levelNodes = levelNodes;
  E.esc = esc;

  initPlannerDiagram(E);
  initPlannerInfo(E);

  /* =================== build view model =================== */
  function build(): void {
    E.byRef = indexByRef(E.plan); E.byId = indexById(E.plan);
    E.synth = {};
    E.plan.changes.forEach((chg) => { const sn = synthNode(chg); if (sn && !ctx.state.nodes[sn.id]) E.synth[sn.id] = sn; });
    E.posCache = {}; E.level = null; E.sel = null; E.phaseFocus = null;
    for (const kk in E.verdicts) delete E.verdicts[kk];
  }

  /* =================== loading: base map + plan patch =================== */

  /** Load a base map from .mmd text through the canonical mermaid apply path. */
  function loadBaseFromText(text: string): boolean {
    const before = Object.keys(ctx.state.nodes).length;
    ctx.dom.mmd.value = text;
    deps.mermaid.applyText();              // parses, writes ctx.state, renders main canvas, syncs, history
    const after = Object.keys(ctx.state.nodes).length;
    const ok = !!text.trim() && after > 0 && (after !== before || before === 0);
    if (ok) refresh();
    return ok;
  }

  /** Load a plan patch from JSON text. Throws on invalid JSON (caller shows the error). */
  function loadPlanFromText(text: string): void {
    const parsed = normalizePlan(JSON.parse(text));
    ctx.plan = parsed; E.plan = parsed;
    refresh();
  }

  /**
   * D2 — unified review: ingest a raw proposal `.mmd` (the after map), diff it
   * against the current diagram, and review the derived plan here — the same
   * surface, accept/reject/blast-radius/export. Returns false if nothing parsed.
   */
  function loadProposalFromText(text: string): boolean {
    let after;
    try { after = fromMermaid(text); } catch { return false; }
    if (!Object.keys(after.nodes).length) return false;
    const before = { nodes: ctx.state.nodes, edges: ctx.state.edges };
    const derived = planFromDiff(before, { nodes: after.nodes, edges: after.edges }, 'pasted proposal');
    ctx.plan = derived; E.plan = derived;
    refresh();
    return true;
  }

  async function loadSample(): Promise<void> {
    try {
      const resp = await fetch('plan.json');
      if (!resp.ok) { ctx.hooks.toast('No sample plan.json found'); return; }
      ctx.plan = normalizePlan(await resp.json()); E.plan = ctx.plan; refresh();
      ctx.hooks.toast('Loaded sample plan');
    } catch { ctx.hooks.toast('Could not load sample plan'); }
  }

  /** Recompute everything after a load (base or plan). Resets the review session. */
  function refresh(): void {
    build();
    updateMeta();
    E.renderPhases(); E.renderLegend(); E.fit(); E.render(); E.renderDif(); E.renderInfo(); E.updateProgress(); updateEmpty();
  }

  function updateMeta(): void {
    const total = Object.keys(ctx.state.nodes).length;
    const resolved = E.plan.changes.filter((chg) => chg.target.kind === 'node' && ctx.state.nodes[chg.target.ref]).length;
    $('plMeta').innerHTML = `base <b>${esc(E.plan.base || '—')}</b> · map <b>${total}</b> nodes · plan <b>${E.plan.changes.length}</b> changes · <b>${E.plan.changes.filter((chg) => chg.status === 'modify').length}</b> modify · <b>${E.plan.changes.filter((chg) => chg.status === 'add').length}</b> new · ${resolved} resolved`;
    $('plBase').textContent = E.plan.base || '—';
  }

  /** Show a guided empty state when there's no base map (nothing to review against). */
  function updateEmpty(): void {
    const noBase = Object.keys(ctx.state.nodes).length === 0;
    const box = $('plEmpty');
    if (!noBase) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    $('plEmptyTitle').textContent = 'No base map loaded';
    $('plEmptyMsg').innerHTML = 'A plan is reviewed against your architecture map. Load the repo’s <b>.mmd</b> (your full map, e.g. <b>docs/novakai/_bundle.mmd</b>) — the AI’s plan patch then overlays on it. The plan itself is a small JSON of changes, loaded separately.';
    $('plEmptyActions').innerHTML = `<button class="pl-btn go" id="plEmptyBase">Load .mmd…</button><button class="pl-btn" id="plEmptyBasePaste">Paste base map</button>`;
    ($('plEmptyBase')).onclick = () => ($('plBaseFile') as HTMLInputElement).click();
    ($('plEmptyBasePaste')).onclick = () => openPaste('base');
  }

  /* =================== paste panel =================== */
  let pasteMode: 'base' | 'plan' | 'proposal' = 'base';
  const PASTE_TITLE = { base: 'Paste base map (.mmd)', plan: 'Paste plan patch (.json)', proposal: 'Paste proposal map (.mmd)' };
  const PASTE_SUB = { base: 'your full architecture map text', plan: 'the small JSON of proposed changes', proposal: 'the proposed after-map — diffed vs the current diagram into a reviewable plan' };
  function openPaste(mode: 'base' | 'plan' | 'proposal'): void {
    pasteMode = mode;
    $('plPasteTitle').textContent = PASTE_TITLE[mode];
    $('plPasteSub').textContent = PASTE_SUB[mode];
    ($('plPasteTa') as HTMLTextAreaElement).value = '';
    $('plPasteErr').textContent = '';
    $('plPaste').style.display = 'flex';
    ($('plPasteTa') as HTMLTextAreaElement).focus();
  }
  function closePaste(): void { $('plPaste').style.display = 'none'; }
  function doPasteParse(): void {
    const text = ($('plPasteTa') as HTMLTextAreaElement).value;
    if (!text.trim()) { $('plPasteErr').textContent = 'Nothing pasted.'; return; }
    if (pasteMode === 'base') {
      if (loadBaseFromText(text)) closePaste();
      else $('plPasteErr').textContent = 'No nodes parsed — is this valid Mermaid flowchart text?';
    } else if (pasteMode === 'proposal') {
      if (loadProposalFromText(text)) closePaste();
      else $('plPasteErr').textContent = 'No nodes parsed — is this valid Mermaid flowchart text?';
    } else {
      try { loadPlanFromText(text); closePaste(); }
      catch (err) { $('plPasteErr').textContent = 'Invalid plan JSON: ' + (err instanceof Error ? err.message : String(err)); }
    }
  }

  /* =================== open / close =================== */
  function open(): void {
    if (ctx.plan) E.plan = ctx.plan;
    ctx.runtime.plannerVisible = true;
    overlay.classList.add('show');
    overlay.focus();
    refresh();
  }
  /** D2 — open the unified surface to review a raw proposal .mmd (diff vs current). */
  function openProposal(): void {
    if (ctx.plan) E.plan = ctx.plan;
    ctx.runtime.plannerVisible = true;
    overlay.classList.add('show');
    overlay.focus();
    refresh();
    openPaste('proposal');
  }
  function close(): void {
    overlay.classList.remove('show');
    ctx.runtime.plannerVisible = false;
    ctx.hooks.plannerClosed();
  }

  /* =================== wire DOM =================== */
  $('plClose').onclick = close;
  $('plExport').onclick = E.doExport;
  $('plSwitch').onclick = E.togglePlan;

  // loaders
  ($('plBaseFile') as HTMLInputElement).onchange = (ev) => {
    const inp = ev.target as HTMLInputElement; const file = inp.files?.[0]; if (!file) return;
    file.text().then((txt) => { if (!loadBaseFromText(txt)) ctx.hooks.toast('No nodes parsed from that .mmd'); else ctx.hooks.toast('Base map loaded'); });
    inp.value = '';
  };
  ($('plPlanFile') as HTMLInputElement).onchange = (ev) => {
    const inp = ev.target as HTMLInputElement; const file = inp.files?.[0]; if (!file) return;
    file.text().then((txt) => { try { loadPlanFromText(txt); ctx.hooks.toast('Plan loaded'); } catch (err) { ctx.hooks.toast('Invalid plan JSON: ' + (err instanceof Error ? err.message : String(err))); } });
    inp.value = '';
  };
  $('plBasePaste').onclick = () => openPaste('base');
  $('plPlanPaste').onclick = () => openPaste('plan');
  $('plProposalPaste').onclick = () => openPaste('proposal');
  $('plSample').onclick = () => { void loadSample(); };
  $('plPasteClose').onclick = closePaste;
  $('plPasteParse').onclick = doPasteParse;

  const wrap = $('plCanvas');
  let dr = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
  wrap.addEventListener('mousedown', (ev) => { if ((ev.target as HTMLElement).closest('.pl-nodeg')) return; dr = true; moved = false; sx = ev.clientX; sy = ev.clientY; ox = E.tx; oy = E.ty; wrap.classList.add('pan'); });
  window.addEventListener('mousemove', (ev) => { if (!dr) return; E.tx = ox + (ev.clientX - sx); E.ty = oy + (ev.clientY - sy); if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true; E.applyT(); });
  window.addEventListener('mouseup', () => { dr = false; wrap.classList.remove('pan'); });
  wrap.addEventListener('click', (ev) => { if (!(ev.target as HTMLElement).closest('.pl-nodeg') && !moved) E.select(null); });
  $('plSvg').addEventListener('wheel', (ev) => {
    ev.preventDefault(); const bbox = wrap.getBoundingClientRect(); const mx = ev.clientX - bbox.left, my = ev.clientY - bbox.top;
    if (ev.ctrlKey || ev.metaKey) { const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1; const wx = (mx - E.tx) / E.k, wy = (my - E.ty) / E.k; E.k = Math.max(0.2, Math.min(2.4, E.k * factor)); E.tx = mx - wx * E.k; E.ty = my - wy * E.k; }
    else { E.tx -= (ev as WheelEvent).deltaX; E.ty -= (ev as WheelEvent).deltaY; }
    E.applyT();
  }, { passive: false });
  overlay.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (E.level !== null) E.toTop(); else close(); } });
  overlay.tabIndex = -1;
  window.addEventListener('resize', () => { if (overlay.classList.contains('show')) E.fit(); });

  return { open, openProposal, close };
}
