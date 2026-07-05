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
import type { DiagramNode, DiagramEdge } from '../../core/types/types';
import type { MermaidApi } from '../../io/mermaid';
import { fromMermaid } from '../../io/mermaid';
import { childIdsOf, containerOf } from '../../core/state/state';
import { frontmatterToMermaid } from '../../core/frontmatter/frontmatter';
import {
  normalizePlan, indexByRef, indexById, downstreamCone, coherenceWarnings, synthNode, applyPlan, levelPositions, planFromDiff,
  type Plan, type PlanChange, type Verdict, type PlanLayoutNode,
} from '../../core/plan/plan';
import type { Frontmatter } from '../../core/types/types';

export interface PlannerApi {
  open: () => void;
  /** open the unified review surface in raw-proposal mode (paste an after .mmd) */
  openProposal: () => void;
  close: () => void;
}

const NS = 'http://www.w3.org/2000/svg';

const KIND_FILL: Record<string, string> = {
  module: '#39456b', function: '#2d3a59', type: '#473a5d', store: '#3a4d48',
  service: '#3a4d48', hook: '#2d3a59', class: '#39456b', component: '#39456b', event: '#3a4d48',
};
const STATUS_COL: Record<string, string> = { existing: '#566089', add: '#5bd6a0', modify: '#e0a44a', remove: '#e06a6a' };
// SVG attribute names repeated across edge-drawing branches (sonarjs/no-duplicate-string).
const ATTR_DASHARRAY = 'stroke-dasharray';
const ATTR_STROKE_WIDTH = 'stroke-width';

const CSS = `
.pl-overlay{position:fixed;inset:0;z-index:80;display:none;background:#0e1016;color:#e6e9f0;
  font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.pl-overlay.show{display:grid;grid-template-columns:1fr 420px;grid-template-rows:auto auto 1fr auto;height:100vh}
.pl-hd{grid-column:1/3;display:flex;align-items:center;gap:14px;padding:9px 16px;background:#13161f;border-bottom:1px solid #2a3042}
.pl-brand{font-weight:700}.pl-brand b{color:#7aa2ff}
.pl-meta{color:#5a6275;font-size:11px;line-height:1.4}.pl-meta b{color:#8b93a7}
.pl-tg{margin-left:auto;display:flex;align-items:center;gap:10px}
.pl-switch{display:flex;align-items:center;gap:7px;cursor:pointer;color:#8b93a7;padding:6px 11px;border:1px solid #2a3042;border-radius:8px;user-select:none}
.pl-switch.on{border-color:#5bd6a0;color:#5bd6a0;background:#10231a}
.pl-pbar{width:130px;height:8px;border-radius:5px;background:#1c2030;overflow:hidden}
.pl-pfill{height:100%;width:0;background:linear-gradient(90deg,#3a7a5a,#5bd6a0);transition:width .3s}
.pl-btn{padding:7px 12px;border-radius:8px;border:1px solid #2a3042;background:#1c2030;color:#e6e9f0;cursor:pointer;font:inherit;font-size:12px}
.pl-btn:hover{border-color:#7aa2ff}.pl-btn.go{background:#7aa2ff;color:#0a0c12;font-weight:700;border:0}
.pl-btn.go:disabled{background:#2a3042;color:#5a6275;cursor:not-allowed}
.pl-load{display:flex;align-items:center;gap:6px}
.pl-load .pl-btn{padding:5px 9px;font-size:11px}
.pl-paste{position:absolute;inset:0;background:#0c0e14ee;z-index:8;display:flex;flex-direction:column;padding:18px;gap:10px}
.pl-paste-hd{display:flex;align-items:center;gap:10px;color:#e6e9f0;font-weight:700}
.pl-paste-hd .sub{font-weight:400;color:#5a6275;font-size:11px}
.pl-paste-hd button{margin-left:auto}
.pl-paste textarea{flex:1;background:#0e1016;border:1px solid #2a3042;border-radius:8px;color:#c9d2e6;font-family:inherit;font-size:12px;padding:10px;resize:none}
.pl-paste-err{color:#e06a6a;font-size:11px;min-height:14px}
.pl-emptystate{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#8b93a7;text-align:center;padding:30px}
.pl-emptystate h3{margin:0;color:#e6e9f0;font-size:16px}
.pl-emptystate .row{display:flex;gap:10px}
.pl-phases{grid-column:1/3;display:flex;background:#11141c;border-bottom:1px solid #2a3042;min-height:46px}
.pl-phase{flex:1;display:flex;flex-direction:column;justify-content:center;padding:6px 16px;border-right:1px solid #2a3042;cursor:pointer;position:relative;color:#8b93a7}
.pl-phase:hover{background:#161b27}.pl-phase.on{background:#1a2030;color:#e6e9f0}
.pl-phase .n{font-size:9px;letter-spacing:1px;color:#5a6275}.pl-phase .t{font-weight:600;font-size:12px}
.pl-phase .c{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:10px;color:#5a6275}
.pl-canvaswrap{grid-row:3;grid-column:1;position:relative;overflow:hidden;background:#0e1016;cursor:grab}
.pl-canvaswrap.pan{cursor:grabbing}
.pl-svg{width:100%;height:100%}
.pl-crumb{position:absolute;left:14px;top:12px;display:flex;gap:6px;align-items:center;color:#8b93a7;font-size:12px;z-index:5}
.pl-crumb b{color:#e6e9f0}.pl-crumblink{cursor:pointer;color:#7aa2ff}
.pl-legend{position:absolute;left:14px;bottom:12px;background:#0c0e14cc;border:1px solid #2a3042;border-radius:9px;padding:9px 12px;font-size:11px;line-height:1.7;max-width:340px}
.pl-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.pl-hint{position:absolute;right:14px;top:12px;color:#5a6275;font-size:11px;text-align:right;line-height:1.6;z-index:5}
.pl-warn{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:#2a1818;border:1px solid #5a2f2f;color:#e06a6a;border-radius:8px;padding:6px 12px;font-size:11px;z-index:6;max-width:60%}
.pl-text{fill:#e6e9f0;pointer-events:none;user-select:none;font-family:inherit}
.pl-nodeg{cursor:pointer}.pl-edge{fill:none;stroke-width:1.4}
.pl-seln{stroke:#7aa2ff;stroke-width:2.5;fill:none}
.pl-faded{opacity:.13;transition:opacity .2s}.pl-full{opacity:1;transition:opacity .2s}
.pl-rail{grid-row:3;grid-column:2;border-left:1px solid #2a3042;background:#161922;display:flex;flex-direction:column;min-height:0}
.pl-info{padding:14px 16px;border-bottom:1px solid #2a3042;overflow:auto;flex:0 0 auto;max-height:56%}
.pl-ihd{display:flex;align-items:center;gap:9px;margin-bottom:8px;flex-wrap:wrap}
.pl-tag{font-size:10px;padding:2px 8px;border-radius:5px;font-weight:700;letter-spacing:.5px}
.pl-tag.add{background:#163a2a;color:#5bd6a0}.pl-tag.modify{background:#3a3217;color:#e0a44a}
.pl-tag.remove{background:#3a1717;color:#e06a6a}.pl-tag.existing{background:#222a3d;color:#566089}.pl-tag.kind{background:#23283a;color:#8b93a7}
.pl-ititle{font-weight:700;font-size:15px}
.pl-field{margin:8px 0}.pl-flabel{color:#5a6275;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
.pl-ftext{color:#e6e9f0;line-height:1.5}
.pl-quote{border-left:2px solid #e0a44a;padding:3px 9px;color:#e0a44a;background:#231f1066;font-size:12px;margin-top:3px}
.pl-risk{font-size:10px;padding:2px 8px;border-radius:20px;border:1px solid}
.pl-risk.low{color:#5bd6a0;border-color:#2f5547}.pl-risk.med{color:#e0a44a;border-color:#5a4a2a}.pl-risk.high{color:#e06a6a;border-color:#5a2f2f}
.pl-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}
.pl-chip{font-size:11px;padding:2px 7px;border-radius:5px;background:#222a3d;color:#aeb6c9;cursor:pointer}
.pl-chip:hover{background:#2d3650}.pl-chip.risk{background:#2a1f12;color:#e0a44a;cursor:default}
.pl-verdict{display:flex;gap:8px;margin-top:12px}
.pl-vbtn{flex:1;padding:9px;border-radius:8px;border:1px solid #2a3042;background:#1c2030;color:#8b93a7;cursor:pointer;font:inherit;font-weight:600}
.pl-vbtn.acc.on,.pl-vbtn.acc:hover{border-color:#5bd6a0;color:#5bd6a0;background:#10231a}
.pl-vbtn.rej.on,.pl-vbtn.rej:hover{border-color:#e06a6a;color:#e06a6a;background:#231010}
pre.pl-sig{background:#0c0e14;border:1px solid #2a3042;border-radius:8px;padding:9px 11px;color:#c9d2e6;font-size:12px;line-height:1.5;overflow:auto;margin:6px 0 0;white-space:pre-wrap}
pre.pl-body{background:#0c0e14;border:1px solid #2a3042;border-radius:8px;padding:9px 11px;color:#aeb6c9;font-size:11px;line-height:1.45;overflow:auto;max-height:230px;margin:6px 0 0;white-space:pre}
.pl-baf{margin-top:4px;display:flex;flex-direction:column;gap:3px}
.pl-baf .row{display:flex;gap:7px;align-items:baseline}
.pl-baf .lab{color:#5a6275;font-size:10px;width:40px;flex:0 0 auto;text-transform:uppercase;letter-spacing:.5px}
.pl-baf code{font-family:inherit;font-size:11.5px;white-space:pre-wrap;line-height:1.45}
.pl-baf .before code{color:#e0857f}.pl-baf .after code{color:#5bd6a0}
.pl-empty{color:#5a6275;padding:24px 16px;text-align:center;line-height:1.7}
.pl-difhd{padding:8px 16px;border-bottom:1px solid #2a3042;color:#5a6275;font-size:11px}
.pl-dif{flex:1;overflow:auto;padding:6px 0;font-size:12px;line-height:1.5;min-height:0}
.pl-ln{padding:2px 16px;white-space:pre-wrap;color:#aeb6c9;cursor:pointer;border-left:2px solid transparent}
.pl-ln.add{background:#10231a;color:#5bd6a0;border-left-color:#5bd6a0}
.pl-ln.modify{background:#231f10;color:#e0a44a;border-left-color:#e0a44a}
.pl-ln.remove{background:#231010;color:#e06a6a;border-left-color:#e06a6a}
.pl-ln.sel{outline:1px solid #7aa2ff;outline-offset:-1px}
.pl-ln .pv{display:inline-block;width:13px;color:#5a6275}
.pl-ln .vd{float:right;font-weight:700}.pl-ln .vd.a{color:#5bd6a0}.pl-ln .vd.r{color:#e06a6a}
.pl-ln .incoh{float:right;color:#e06a6a;margin-right:6px}
.pl-verify{grid-column:1/3;display:flex;align-items:center;gap:13px;padding:9px 16px;background:#11141c;border-top:1px solid #2a3042;font-size:12px}
.pl-step{display:flex;align-items:center;gap:7px;color:#8b93a7}.pl-step .dot{width:9px;height:9px;border-radius:50%;background:#5a6275}
.pl-step.done .dot{background:#5bd6a0}.pl-step.active .dot{background:#7aa2ff;box-shadow:0 0 0 3px #7aa2ff33}
.pl-arrow{color:#5a6275}.pl-vmsg{margin-left:auto;color:#5a6275}
`;

// Build the planner overlay (DOM + CSS + session state) and return its open/openProposal/close API.
export function initPlanner(ctx: AppContext, deps: { mermaid: MermaidApi }): PlannerApi {
  /* ---- inject stylesheet once ---- */
  if (!document.getElementById('planner-styles')) {
    const st = document.createElement('style');
    st.id = 'planner-styles';
    st.textContent = CSS;
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

  /* ---- session state ---- */
  let plan: Plan = { base: '', changes: [] };
  let byRef: Record<string, PlanChange> = {};
  let byId: Record<string, PlanChange> = {};
  let synth: Record<string, DiagramNode> = {};   // synthesised add-nodes (view only)
  const verdicts: Record<string, Verdict | undefined> = {};
  let level: string | null = null;               // null = top, else unit id
  let sel: string | null = null;                 // node id or edgeKey
  let planOn = true;
  let phaseFocus: number | null = null;
  let posCache: Record<string, Record<string, { x: number; y: number }>> = {};
  let k = 1, tx = 0, ty = 0;

  /* ---- node lookup across real + synth ---- */
  const node = (id: string): DiagramNode | undefined => ctx.state.nodes[id] ?? synth[id];
  const isSynthChild = (id: string, container: string | null): boolean => {
    const syn = synth[id];
    return !!syn && (syn.parent ?? null) === container;
  };

  /* ---- which nodes live at the current level ---- */
  function levelNodes(): string[] {
    const real = childIdsOf(ctx.state, level).filter((id) => ctx.state.nodes[id].shape !== 'group');
    const syn = Object.keys(synth).filter((id) => isSynthChild(id, level));
    return [...real, ...syn];
  }

  /* =================== layout =================== */
  /**
   * D1 — layout fidelity: the review canvas mirrors the human's REAL ctx.state
   * positions (the live canvas), never a re-simulated force layout. Real nodes
   * use their verbatim (x, y); only synth add-nodes get a computed slot. The
   * placement rule is the pure levelPositions() in core/plan, so it is testable.
   */
  function layoutLevel(): Record<string, { x: number; y: number }> {
    const key = level ?? '__top__';
    if (posCache[key]) return posCache[key];
    const ids = levelNodes();
    const lnodes: PlanLayoutNode[] = ids.map((id) => {
      const real = ctx.state.nodes[id];
      if (real) return { id, x: real.x, y: real.y, synth: false };
      const synNode = synth[id];
      return { id, x: 0, y: 0, parent: synNode?.parent ?? null, synth: true };
    });
    const pos = levelPositions(lnodes);
    posCache[key] = pos;
    return pos;
  }

  /* =================== camera =================== */
  function applyT(): void { $('plWorld').setAttribute('transform', `translate(${tx},${ty}) scale(${k})`); }
  function fit(): void {
    const wrap = $('plCanvas'); const wrapW = wrap.clientWidth, wrapH = wrap.clientHeight;
    const pos = layoutLevel(); const pts = Object.values(pos); if (!pts.length) { applyT(); return; }
    const pad = 80;
    const x0 = Math.min(...pts.map((pt) => pt.x)) - pad, x1 = Math.max(...pts.map((pt) => pt.x)) + 180 + pad;
    const y0 = Math.min(...pts.map((pt) => pt.y)) - pad, y1 = Math.max(...pts.map((pt) => pt.y)) + 60 + pad;
    k = Math.min(wrapW / (x1 - x0), wrapH / (y1 - y0), 1.4);
    tx = (wrapW - (x1 - x0) * k) / 2 - x0 * k; ty = (wrapH - (y1 - y0) * k) / 2 - y0 * k; applyT();
  }
  /* =================== render =================== */
  type Center = (id: string) => { x: number; y: number };

  /** focus set — selecting a node lights its direct neighbours, dims the rest. */
  function computeLitSet(idset: Set<string>): Set<string> | null {
    if (!sel || !idset.has(sel)) return null;
    const lit = new Set([sel]);
    ctx.state.edges.forEach((edge) => { if (edge.from === sel && idset.has(edge.to)) lit.add(edge.to); if (edge.to === sel && idset.has(edge.from)) lit.add(edge.from); });
    return lit;
  }

  /** real edges within the current level. */
  function drawRealEdges(eg: HTMLElement, idset: Set<string>, center: Center, lit: Set<string> | null): void {
    ctx.state.edges.forEach((edge) => {
      if (!idset.has(edge.from) || !idset.has(edge.to)) return;
      const ptFrom = center(edge.from), ptTo = center(edge.to); const mx = (ptFrom.x + ptTo.x) / 2;
      const path = el('path'); path.setAttribute('d', `M${ptFrom.x},${ptFrom.y} C ${mx},${ptFrom.y} ${mx},${ptTo.y} ${ptTo.x},${ptTo.y}`);
      const dim = lit && !(lit.has(edge.from) && lit.has(edge.to));
      path.setAttribute('class', 'pl-edge ' + (dim ? 'pl-faded' : 'pl-full'));
      path.setAttribute('stroke', edge.style === 'dotted' ? '#39426b' : '#54608a');
      if (edge.style === 'dotted') path.setAttribute(ATTR_DASHARRAY, '4 4');
      eg.appendChild(path);
    });
  }

  /** plan EDGE changes within the current level (ghost edges, selectable). */
  function drawPlanGhostEdges(eg: HTMLElement, idset: Set<string>, center: Center): void {
    plan.changes.filter((chg) => chg.target.kind === 'edge' && chg.newEdge).forEach((chg) => {
      const { from, to } = chg.newEdge!;
      if (!idset.has(from) || !idset.has(to)) return;
      const ptFrom = center(from), ptTo = center(to); const mx = (ptFrom.x + ptTo.x) / 2;
      const path = el('path'); path.setAttribute('d', `M${ptFrom.x},${ptFrom.y} C ${mx},${ptFrom.y} ${mx},${ptTo.y} ${ptTo.x},${ptTo.y}`);
      path.setAttribute('class', 'pl-edge pl-nodeg ' + (phaseFocus && chg.phase !== phaseFocus ? 'pl-faded' : 'pl-full'));
      path.setAttribute('stroke', STATUS_COL[chg.status]); path.setAttribute(ATTR_STROKE_WIDTH, '2.4'); path.setAttribute(ATTR_DASHARRAY, '7 4');
      if (sel === chg.target.ref) path.setAttribute(ATTR_STROKE_WIDTH, '3.4');
      path.addEventListener('click', (ev) => { ev.stopPropagation(); select(chg.target.ref); });
      eg.appendChild(path);
    });
  }

  /** dependency arrows between visible change nodes (amber dashed). */
  function drawDependencyArrows(eg: HTMLElement, idset: Set<string>, center: Center): void {
    plan.changes.forEach((chg) => {
      if (!chg.dependsOn?.length || chg.target.kind !== 'node' || !idset.has(chg.target.ref)) return;
      chg.dependsOn.forEach((depId) => {
        const dep = byId[depId]; if (!dep || dep.target.kind !== 'node' || !idset.has(dep.target.ref)) return;
        const ptFrom = center(dep.target.ref), ptTo = center(chg.target.ref); const mx = (ptFrom.x + ptTo.x) / 2;
        const path = el('path'); path.setAttribute('d', `M${ptFrom.x},${ptFrom.y} C ${mx},${ptFrom.y} ${mx},${ptTo.y} ${ptTo.x},${ptTo.y}`);
        path.setAttribute('class', 'pl-edge pl-full'); path.setAttribute('stroke', '#7a6a3a'); path.setAttribute(ATTR_DASHARRAY, '2 5'); path.setAttribute(ATTR_STROKE_WIDTH, '1.6');
        eg.appendChild(path);
      });
    });
  }

  // per-node draw-time context (box size + layout + focus/coherence sets), bundled to
  // keep drawNode and its helpers under the max-params limit.
  type NodeRenderCtx = {
    pos: Record<string, { x: number; y: number }>;
    boxWidth: number;
    boxHeight: number;
    lit: Set<string> | null;
    warns: Set<string>;
  };

  /** whether a node should render dimmed (out of focus / out of the active phase). */
  function isNodeDimmed(id: string, ch: PlanChange | undefined, lit: Set<string> | null): boolean {
    return (!!lit && !lit.has(id)) || (planOn && !!phaseFocus && !!ch && ch.phase !== phaseFocus) || (planOn && !!phaseFocus && !ch && id !== sel);
  }

  /** node box fill — change-status tint, else the kind's base colour. */
  function nodeFillColor(ch: PlanChange | undefined, nd: DiagramNode): string {
    if (!ch) return KIND_FILL[nd.kind ?? 'module'] || KIND_FILL.module;
    if (ch.status === 'add') return '#16332544';
    if (ch.status === 'remove') return '#33161644';
    return '#33301644';
  }

  /** node subtitle — change status, else synth "new", else the real kind (+ fn count at top level). */
  function nodeSubtitleText(ch: PlanChange | undefined, nd: DiagramNode, id: string, nfn: number): string {
    if (ch) return ch.status.toUpperCase() + (ch.phase ? ' · P' + ch.phase : '');
    if (synth[id]) return 'new · ' + (nd.kind ?? 'module');
    return (nd.kind ?? '') + (level === null && nfn ? ` · ${nfn} fns` : '');
  }

  /** top-right mark: a coherence warning wins over a plain accept/reject verdict mark. */
  function appendStatusMark(grp: SVGElement, id: string, ch: PlanChange | undefined, rc: NodeRenderCtx): void {
    if (rc.warns.has(byRef[id]?.id ?? '')) {
      const warn = el('text'); warn.setAttribute('x', String(rc.boxWidth - 11)); warn.setAttribute('y', '17'); warn.setAttribute('text-anchor', 'end'); warn.setAttribute('class', 'pl-text'); warn.setAttribute('font-size', '13'); warn.setAttribute('fill', '#e06a6a'); warn.textContent = '⚠'; grp.appendChild(warn);
      return;
    }
    if (ch && verdicts[ch.id]) {
      const vm = el('text'); vm.setAttribute('x', String(rc.boxWidth - 11)); vm.setAttribute('y', '17'); vm.setAttribute('text-anchor', 'end'); vm.setAttribute('class', 'pl-text'); vm.setAttribute('font-size', '13'); vm.setAttribute('fill', verdicts[ch.id] === 'accept' ? '#5bd6a0' : '#e06a6a'); vm.textContent = verdicts[ch.id] === 'accept' ? '✓' : '✕'; grp.appendChild(vm);
    }
  }

  /** selection outline around the node, only for the currently-selected id. */
  function appendSelectionOutline(grp: SVGElement, id: string, rc: NodeRenderCtx): void {
    if (sel !== id) return;
    const sr = el('rect'); sr.setAttribute('class', 'pl-seln'); sr.setAttribute('x', '-4'); sr.setAttribute('y', '-4'); sr.setAttribute('width', String(rc.boxWidth + 8)); sr.setAttribute('height', String(rc.boxHeight + 8)); sr.setAttribute('rx', '12'); grp.appendChild(sr);
  }

  /** draw one node group (box + pip + label + status mark + selection outline). */
  function drawNode(ng: HTMLElement, id: string, rc: NodeRenderCtx): void {
    const nd = node(id)!; const pt = rc.pos[id] || { x: 0, y: 0 };
    const ch = planOn ? byRef[id] : undefined;
    const grp = el('g');
    grp.setAttribute('class', 'pl-nodeg ' + (isNodeDimmed(id, ch, rc.lit) ? 'pl-faded' : 'pl-full'));
    grp.setAttribute('transform', `translate(${pt.x},${pt.y})`);
    const rect = el('rect'); rect.setAttribute('width', String(rc.boxWidth)); rect.setAttribute('height', String(rc.boxHeight)); rect.setAttribute('rx', '9');
    rect.setAttribute('fill', nodeFillColor(ch, nd));
    rect.setAttribute('stroke', ch ? STATUS_COL[ch.status] : '#2a3042'); rect.setAttribute(ATTR_STROKE_WIDTH, ch ? '2' : '1.5');
    grp.appendChild(rect);
    if (ch) { const pip = el('rect'); pip.setAttribute('width', '5'); pip.setAttribute('height', String(rc.boxHeight)); pip.setAttribute('rx', '2'); pip.setAttribute('fill', STATUS_COL[ch.status]); grp.appendChild(pip); }
    const titleEl = el('text'); titleEl.setAttribute('x', '14'); titleEl.setAttribute('y', level === null ? '23' : '20'); titleEl.setAttribute('class', 'pl-text'); titleEl.setAttribute('font-size', '13'); titleEl.setAttribute('font-weight', '600'); titleEl.textContent = nd.label; grp.appendChild(titleEl);
    const sub = el('text'); sub.setAttribute('x', '14'); sub.setAttribute('y', level === null ? '41' : '36'); sub.setAttribute('class', 'pl-text'); sub.setAttribute('font-size', '9.5'); sub.setAttribute('fill', '#8b93a7');
    const nfn = childIdsOf(ctx.state, id).filter((cid) => ctx.state.nodes[cid].shape !== 'group').length;
    sub.textContent = nodeSubtitleText(ch, nd, id, nfn);
    grp.appendChild(sub);
    appendStatusMark(grp, id, ch, rc);
    appendSelectionOutline(grp, id, rc);
    grp.addEventListener('click', (ev) => { ev.stopPropagation(); select(id); });
    grp.addEventListener('dblclick', (ev) => { ev.stopPropagation(); if (level === null && nfn) drill(id); });
    ng.appendChild(grp);
  }

  /** breadcrumb — top level, or drilled-in unit with a link back to top. */
  function renderCrumb(ids: string[]): void {
    if (level === null) $('plCrumb').innerHTML = `<b>top level</b> · ${ids.length} modules`;
    else $('plCrumb').innerHTML = `<span class="pl-crumblink" id="plToTop">top level</span> › <b>${node(level)!.label}</b> · ${ids.length} units`;
    const tt = document.getElementById('plToTop'); if (tt) tt.onclick = toTop;
  }

  /** banner listing any dependency-incoherent verdicts. */
  function renderCoherenceBanner(): void {
    const cw = coherenceWarnings(plan, verdicts);
    const banner = $('plWarnBanner');
    if (cw.length) { banner.style.display = 'block'; banner.textContent = `⚠ ${cw.length} incoherent verdict${cw.length > 1 ? 's' : ''}: ` + cw.map((warn) => warn.changeId).join(', '); }
    else banner.style.display = 'none';
  }

  function render(): void {
    const ng = $('plNodes'), eg = $('plEdges'); ng.innerHTML = ''; eg.innerHTML = '';
    const ids = levelNodes(); const idset = new Set(ids); const pos = layoutLevel();
    const boxWidth = 180, boxHeight = level === null ? 54 : 46;
    const center: Center = (id) => { const pt = pos[id] || { x: 0, y: 0 }; return { x: pt.x + boxWidth / 2, y: pt.y + boxHeight / 2 }; };

    const lit = computeLitSet(idset);
    drawRealEdges(eg, idset, center, lit);
    if (planOn) {
      drawPlanGhostEdges(eg, idset, center);
      drawDependencyArrows(eg, idset, center);
    }

    const warns = new Set(coherenceWarnings(plan, verdicts).map((warn) => warn.changeId));
    const rc: NodeRenderCtx = { pos, boxWidth, boxHeight, lit, warns };
    ids.forEach((id) => drawNode(ng, id, rc));

    renderCrumb(ids);
    renderCoherenceBanner();
  }

  /* =================== drill =================== */
  function drill(id: string): void { level = id; sel = null; fit(); render(); renderInfo(); }
  function toTop(): void { level = null; sel = null; fit(); render(); renderInfo(); }

  /* =================== select + info =================== */
  function select(ref: string | null): void { sel = ref; render(); renderInfo(); renderDif(); }

  function esc(str: string): string { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /** One-line public signature from a frontmatter (first interface). */
  function sigLine(fm: Frontmatter | undefined, fallbackName: string): string {
    if (!fm) return fallbackName;
    const i0 = fm.interfaces?.[0];
    const nm = (fm.name || fallbackName) + (i0?.name ? '.' + i0.name : '');
    const acc = i0?.accepts?.join(', ') || '';
    const ret = i0?.returns?.length ? ' → ' + i0.returns.join(' | ') : '';
    return `${nm}(${acc})${ret}`;
  }

  /** Real source body for a node id, from the loaded bodies.json (null when absent). */
  function bodyOf(id: string): string | null { return ctx.bodies?.get(id)?.body ?? null; }

  function renderInfo(): void {
    const box = $('plInfo');
    if (!sel) {
      const nMod = plan.changes.filter((chg) => chg.status === 'modify').length;
      const nAdd = plan.changes.filter((chg) => chg.status === 'add').length;
      box.innerHTML = `<div class="pl-empty"><b style="color:#8b93a7">Build plan over the real map.</b><br>${plan.changes.length} changes · ${nMod} modify existing · ${nAdd} new.<br><br>Click a node or a diff line → intent + accept/reject.<br><br><span style="color:#e0a44a">amber</span>=modify · <span style="color:#5bd6a0">green</span>=new · <span style="color:#e06a6a">red</span>=remove.</div>`;
      return;
    }
    const ch = planOn ? byRef[sel] : undefined;
    if (ch) { renderChangeInfo(box, ch); return; }
    // plain existing node
    const nd = node(sel);
    if (!nd) { box.innerHTML = `<div class="pl-empty">${esc(sel)}</div>`; return; }
    const fm = nd.fm; const i0 = fm?.interfaces?.[0];
    const sig = fm ? `<pre class="pl-sig">${esc((fm.name || nd.id) + (i0?.name ? '.' + i0.name : '') + '(' + (i0?.accepts?.join(', ') || '') + ')' + (i0?.returns?.length ? ' → ' + i0.returns.join(' | ') : '') + (fm.state?.length ? '\nstate: ' + fm.state.join('; ') : ''))}</pre>` : '';
    const nfn = childIdsOf(ctx.state, nd.id).filter((cid) => ctx.state.nodes[cid].shape !== 'group').length;
    const body = bodyOf(nd.id);
    const codeToday = body ? `<div class="pl-field"><div class="pl-flabel">source</div><pre class="pl-body">${esc(body)}</pre></div>` : '';
    box.innerHTML = `<div class="pl-ihd"><span class="pl-tag existing">EXISTING</span><span class="pl-tag kind">${esc(nd.kind ?? '')}</span><span class="pl-ititle">${esc(nd.label)}</span></div>
      ${fm?.description ? `<div class="pl-field"><div class="pl-flabel">desc</div><div class="pl-ftext">${esc(fm.description)}</div></div>` : ''}
      ${sig}
      ${codeToday}
      ${nfn ? `<div class="pl-field" style="margin-top:10px"><div class="pl-flabel">drill-in</div><div class="pl-ftext">${nfn} units — double-click to open</div></div>` : ''}
      <div class="pl-meta" style="margin-top:10px">real node · ${byRef[nd.id] ? 'in plan' : 'not touched by this plan'}</div>`;
  }

  /** "real code today" quote — only when the change explicitly quotes the real fm description. */
  function quoteBlockHtml(ch: PlanChange, target: DiagramNode | undefined): string {
    if (!ch.quoteReal || !target?.fm?.description) return '';
    return `<div class="pl-field"><div class="pl-flabel">real code today</div><div class="pl-quote">${esc((target.fm.name || ch.target.ref) + ' — ' + target.fm.description)}</div></div>`;
  }

  /** transitive blast radius for a node change (the real downstream cone). */
  function blastRadiusBlockHtml(ch: PlanChange, isEdge: boolean, real: boolean): string {
    if (isEdge || !real) return '';
    const cone = downstreamCone(ctx.state.edges, ch.target.ref, { roots: ctx.state.roots });
    if (!cone.affected.length) return '';
    const direct = cone.affected.filter((aff) => aff.depth === 1).length;
    const chips = cone.affected.slice(0, 12).map((aff) =>
      `<span class="pl-chip" data-ref="${esc(aff.id)}" title="${aff.depth} hop${aff.depth > 1 ? 's' : ''} downstream">${esc(node(aff.id)?.label ?? aff.id)}${aff.depth > 1 ? ` ·${aff.depth}` : ''}</span>`).join('');
    const more = cone.affected.length > 12 ? `<span class="pl-chip" style="cursor:default;background:none;color:#5a6275">+${cone.affected.length - 12} more</span>` : '';
    const ep = cone.entryPoints.length ? ` · reaches ${cone.entryPoints.length} entry point${cone.entryPoints.length > 1 ? 's' : ''}` : '';
    return `<div class="pl-field"><div class="pl-flabel">blast radius · ${cone.affected.length} affected${direct < cone.affected.length ? ` (${direct} direct, depth ≤ ${cone.maxDepth})` : ''}${ep}</div><div class="pl-chips">${chips}${more}</div></div>`;
  }

  // before/after public signature — present when the change proposes a new fm.
  // This is the contract the reviewer is actually approving (Phase 1b).
  function signatureBlockHtml(ch: PlanChange, isEdge: boolean, target: DiagramNode | undefined): string {
    if (isEdge || !ch.fm) return '';
    const after = sigLine(ch.fm, ch.target.ref);
    const before = ch.status === 'modify' ? sigLine(target?.fm, ch.target.ref) : null;
    return `<div class="pl-field"><div class="pl-flabel">contract · signature</div><div class="pl-baf">`
      + (before ? `<div class="row before"><span class="lab">before</span><code>${esc(before)}</code></div>` : '')
      + `<div class="row after"><span class="lab">${before ? 'after' : 'new'}</span><code>${esc(after)}</code></div></div></div>`;
  }

  // real code today — for a modify, surface the actual source body (PLANNER_HANDOVER #3),
  // so the reviewer judges the change against real code, not the AI's prose.
  function codeTodayBlockHtml(ch: PlanChange, isEdge: boolean): string {
    if (isEdge || ch.status !== 'modify') return '';
    const body = bodyOf(ch.target.ref);
    return body ? `<div class="pl-field"><div class="pl-flabel">code today</div><pre class="pl-body">${esc(body)}</pre></div>` : '';
  }

  /** "depends on" chip list for a change. */
  function dependsOnBlockHtml(ch: PlanChange): string {
    if (!ch.dependsOn?.length) return '';
    const chips = ch.dependsOn.map((depId) => { const dc = byId[depId]; const vd = verdicts[depId]; const mark = vd === 'reject' ? ' ✕' : vd === 'accept' ? ' ✓' : ''; return `<span class="pl-chip" data-change="${esc(depId)}">${esc(dc?.target.ref ?? depId)}${mark}</span>`; }).join('');
    return `<div class="pl-field"><div class="pl-flabel">depends on</div><div class="pl-chips">${chips}</div></div>`;
  }

  /** wire the accept/reject buttons + blast-radius/depends-on chips rendered above. */
  function wireChangeInfoHandlers(box: HTMLElement, ch: PlanChange): void {
    box.querySelectorAll<HTMLElement>('.pl-vbtn').forEach((btn) => { btn.onclick = () => setVerdict(ch.id, btn.dataset.v as Verdict); });
    box.querySelectorAll<HTMLElement>('.pl-chip[data-ref]').forEach((chip) => { chip.onclick = () => focusRef(chip.dataset.ref!); });
    box.querySelectorAll<HTMLElement>('.pl-chip[data-change]').forEach((chip) => { chip.onclick = () => { const dep = byId[chip.dataset.change!]; if (dep) focusRef(dep.target.ref); }; });
  }

  function renderChangeInfo(box: HTMLElement, ch: PlanChange): void {
    const isEdge = ch.target.kind === 'edge';
    const target = node(ch.target.ref);
    const title = isEdge ? (ch.newEdge ? `${ch.newEdge.from} → ${ch.newEdge.to}` : ch.target.ref) : (target?.label ?? ch.target.ref);
    const phaseTxt = ch.phase ? 'P' + ch.phase : '';
    const real = !isEdge && !!ctx.state.nodes[ch.target.ref];
    const opt = (label: string, val?: string): string => val ? `<div class="pl-field"><div class="pl-flabel">${label}</div><div class="pl-ftext">${esc(val)}</div></div>` : '';

    const quote = quoteBlockHtml(ch, target);
    const blast = blastRadiusBlockHtml(ch, isEdge, real);
    const sigBlock = signatureBlockHtml(ch, isEdge, target);
    const codeBlock = codeTodayBlockHtml(ch, isEdge);
    const deps = dependsOnBlockHtml(ch);

    box.innerHTML = `<div class="pl-ihd"><span class="pl-tag ${ch.status}">${ch.status.toUpperCase()}</span><span class="pl-ititle">${esc(title)}</span>
        ${ch.risk ? `<span style="margin-left:auto"><span class="pl-risk ${ch.risk}">${ch.risk} risk</span></span>` : ''}</div>
      <div class="pl-meta" style="margin:-2px 0 8px">${phaseTxt ? phaseTxt + ' · ' : ''}${isEdge ? 'edge change' : (ch.status === 'modify' ? 'modifies real ' + ch.target.ref : 'new ' + (ch.newNode?.kind ?? 'module'))}</div>
      <div class="pl-field"><div class="pl-flabel">problem</div><div class="pl-ftext">${esc(ch.intent.problem)}</div></div>
      ${quote}
      <div class="pl-field"><div class="pl-flabel">approach</div><div class="pl-ftext">${esc(ch.intent.approach)}</div></div>
      ${opt('rationale', ch.intent.rationale)}
      ${opt('alternative considered', ch.intent.alternative)}
      ${opt('tradeoff', ch.intent.tradeoff)}
      ${sigBlock}
      ${deps}
      ${blast}
      ${codeBlock}
      <div class="pl-verdict">
        <button class="pl-vbtn acc ${verdicts[ch.id] === 'accept' ? 'on' : ''}" data-v="accept">✓ accept</button>
        <button class="pl-vbtn rej ${verdicts[ch.id] === 'reject' ? 'on' : ''}" data-v="reject">✕ reject</button></div>`;

    wireChangeInfoHandlers(box, ch);
  }

  /** Jump selection to a ref, drilling out to the level it lives on if needed. */
  function focusRef(ref: string): void {
    const nd = node(ref);
    if (nd) {
      const lvl = ctx.state.nodes[ref] ? containerOf(ctx.state, ref) : (synth[ref]?.parent ?? null);
      if (lvl !== level) { level = lvl; fit(); }
    }
    select(ref);
  }

  function setVerdict(changeId: string, vd: Verdict): void {
    verdicts[changeId] = verdicts[changeId] === vd ? undefined : vd;
    render(); renderInfo(); renderDif(); updateProgress();
  }

  /* =================== diff list =================== */
  function renderDif(): void {
    const box = $('plDif');
    const warns = new Set(coherenceWarnings(plan, verdicts).map((warn) => warn.changeId));
    const lines: string[] = [];
    const order = [...plan.changes].sort((ca, cb) => (ca.phase ?? 9) - (cb.phase ?? 9));
    let curPhase = -1;
    order.forEach((chg) => {
      if ((chg.phase ?? 9) !== curPhase) {
        curPhase = chg.phase ?? 9;
        const phase = plan.phases?.find((ph) => ph.id === curPhase);
        lines.push(`<div class="pl-ln" style="cursor:default;color:#5a6275;background:none">${esc(phase ? '— ' + phase.title + ' —' : '— phase ' + curPhase + ' —')}</div>`);
      }
      const pfx = chg.status === 'add' ? '+' : chg.status === 'remove' ? '−' : '~';
      const selCls = chg.target.ref === sel ? ' sel' : '';
      const verdict = verdicts[chg.id]; const vdMark = verdict === 'accept' ? '<span class="vd a">✓</span>' : verdict === 'reject' ? '<span class="vd r">✕</span>' : '';
      const incoh = warns.has(chg.id) ? '<span class="incoh">⚠</span>' : '';
      const what = chg.target.kind === 'edge' ? (chg.newEdge ? `${chg.newEdge.from}→${chg.newEdge.to}` : chg.target.ref) : chg.target.ref;
      lines.push(`<div class="pl-ln ${chg.status}${selCls}" data-ref="${esc(chg.target.ref)}"><span class="pv">${pfx}</span>${esc(what)} <span style="color:#5a6275">· ${esc(chg.intent.approach.slice(0, 48))}…</span>${incoh}${vdMark}</div>`);
    });
    box.innerHTML = lines.join('');
    box.querySelectorAll<HTMLElement>('.pl-ln[data-ref]').forEach((ln) => { ln.onclick = () => focusRef(ln.dataset.ref!); });
    const selEl = box.querySelector('.pl-ln.sel'); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  /* =================== phases =================== */
  function renderPhases(): void {
    const ph = plan.phases ?? [];
    $('plPhases').innerHTML = ph.map((phase) => {
      const cnt = plan.changes.filter((chg) => chg.phase === phase.id).length;
      return `<div class="pl-phase ${phaseFocus === phase.id ? 'on' : ''}" data-p="${phase.id}"><span class="n">${esc(phase.subtitle ?? '')}</span><span class="t">${esc(phase.title)}</span><span class="c">${cnt} changes</span></div>`;
    }).join('');
    $('plPhases').querySelectorAll<HTMLElement>('.pl-phase').forEach((pd) => { pd.onclick = () => { const id = +pd.dataset.p!; phaseFocus = phaseFocus === id ? null : id; renderPhases(); render(); }; });
  }

  function renderLegend(): void {
    $('plLegend').innerHTML = `<div style="color:#8b93a7;margin-bottom:3px">plan overlay — metadata on real nodes/edges</div>
      <div><span class="pl-sw" style="background:#566089"></span>existing (untouched)</div>
      <div><span class="pl-sw" style="background:#e0a44a"></span>modify &nbsp;<span class="pl-sw" style="background:#5bd6a0"></span>new &nbsp;<span class="pl-sw" style="background:#e06a6a"></span>remove</div>
      <div style="color:#5a6275;margin-top:3px">dashed amber = change depends-on · double-click → drill</div>`;
  }

  /* =================== progress / export =================== */
  function updateProgress(): void {
    const total = plan.changes.length;
    const done = plan.changes.filter((chg) => verdicts[chg.id]).length;
    const acc = plan.changes.filter((chg) => verdicts[chg.id] === 'accept').length;
    const cw = coherenceWarnings(plan, verdicts).length;
    $('plProg').textContent = `${done}/${total} reviewed`;
    ($('plFill') as HTMLElement).style.width = (total ? done / total * 100 : 0) + '%';
    const ready = done === total && cw === 0;
    ($('plExport') as HTMLButtonElement).disabled = !ready;
    $('plS2').className = 'pl-step ' + (done === total ? 'done' : 'active');
    $('plS3').className = 'pl-step ' + (ready ? 'active' : '');
    $('plVmsg').textContent = cw ? `resolve ${cw} incoherent verdict${cw > 1 ? 's' : ''} to export`
      : done === total ? `${acc} accepted · ready to export to buildspec`
        : `review ${total - done} more to unlock export`;
  }
  /** Serialize a model to a pipeline-parseable spec .mmd (fm:meta + kind + parent + nodes + edges). */
  function serializeSpec(model: { nodes: Record<string, DiagramNode>; edges: DiagramEdge[] }): string {
    const ids = Object.keys(model.nodes).sort();
    let out = 'flowchart TD\n';
    for (const id of ids) { const fm = model.nodes[id].fm; if (fm) out += frontmatterToMermaid(id, fm); }
    for (const id of ids) { const kind = model.nodes[id].kind; if (kind) out += `%% kind ${id} ${kind}\n`; }
    for (const id of ids) {
      const parent = model.nodes[id].parent;
      if (parent && model.nodes[parent] && model.nodes[parent].shape !== 'group') out += `%% parent ${id} ${parent}\n`;
    }
    for (const id of ids) { const nd = model.nodes[id]; if (nd.shape !== 'group') out += `  ${id}["${nd.label.replace(/"/g, '')}"]\n`; }
    const arrow: Record<string, string> = { solid: '-->', thick: '==>', dotted: '-.->' };
    for (const edge of model.edges) out += `  ${edge.from} ${arrow[edge.style] || '-->'} ${edge.to}\n`;
    return out;
  }

  function downloadText(filename: string, text: string): void {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function doExport(): void {
    const total = plan.changes.length, done = plan.changes.filter((chg) => verdicts[chg.id]).length;
    if (done < total || coherenceWarnings(plan, verdicts).length) { ctx.hooks.toast('Resolve all changes + coherence first'); return; }
    const isAcc = (id: string): boolean => verdicts[id] === 'accept';
    const accepted = plan.changes.filter((chg) => isAcc(chg.id));

    // (1) the DECISION ARTIFACT (H2) — the human's per-change verdicts captured as
    // DATA, not discarded. approve-export.mjs --accepted-only consumes this to mint the
    // SAME enforceable bundle (approved.mmd + contracts + CHECKLIST + plan.json), so the
    // human review is itself a verifiable artifact and editor-approval drives the CLI bundle.
    const decisionVerdicts: Record<string, Verdict> = {};
    for (const [id, vd] of Object.entries(verdicts)) if (vd) decisionVerdicts[id] = vd;
    const decision: Plan = { ...plan, verdicts: decisionVerdicts };
    downloadText('approved-plan.json', JSON.stringify(decision, null, 2));

    // (2) the approved spec preview = base map + accepted adds / removes / fm-mutations
    // (visual reference; the CLI re-derives the canonical map via toMmd from the artifact above).
    const model = applyPlan(ctx.state, plan, isAcc);
    downloadText('approved-spec.mmd', serializeSpec(model));

    // the build checklist — exactly what the gate flags as "unbuilt" until coded.
    const newNodes = accepted.filter((chg) => chg.status === 'add' && chg.target.kind === 'node').length;
    const newEdges = accepted.filter((chg) => chg.status === 'add' && chg.target.kind === 'edge').length;
    const mods = accepted.filter((chg) => chg.status === 'modify').length;
    const removes = accepted.filter((chg) => chg.status === 'remove').length;
    const withSig = accepted.filter((chg) => chg.fm).length;

    $('plS3').className = 'pl-step done'; $('plS4').className = 'pl-step active';
    $('plVmsg').innerHTML = `<b style="color:#5bd6a0">approved-plan.json</b> downloaded (${accepted.length} accepted) · ${newNodes} new + ${mods} modified → run <code>novakai:approve -- --plan approved-plan.json --accepted-only --out build/approval</code>`;
    ctx.hooks.toast(`Decision artifact: ${accepted.length} accepted (${newNodes} new node(s), ${newEdges} edge(s), ${mods} modify, ${removes} remove · ${withSig} carry a signature contract) → approve-export --accepted-only`);
  }

  function togglePlan(): void {
    planOn = !planOn;
    $('plSwitch').className = 'pl-switch' + (planOn ? ' on' : '');
    $('plSwitch').textContent = (planOn ? '● ' : '○ ') + 'plan overlay';
    render(); renderInfo();
  }

  /* =================== build view model =================== */
  function build(): void {
    byRef = indexByRef(plan); byId = indexById(plan);
    synth = {};
    plan.changes.forEach((chg) => { const sn = synthNode(chg); if (sn && !ctx.state.nodes[sn.id]) synth[sn.id] = sn; });
    posCache = {}; level = null; sel = null; phaseFocus = null;
    for (const kk in verdicts) delete verdicts[kk];
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
    ctx.plan = parsed; plan = parsed;
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
    ctx.plan = derived; plan = derived;
    refresh();
    return true;
  }

  async function loadSample(): Promise<void> {
    try {
      const resp = await fetch('plan.json');
      if (!resp.ok) { ctx.hooks.toast('No sample plan.json found'); return; }
      ctx.plan = normalizePlan(await resp.json()); plan = ctx.plan; refresh();
      ctx.hooks.toast('Loaded sample plan');
    } catch { ctx.hooks.toast('Could not load sample plan'); }
  }

  /** Recompute everything after a load (base or plan). Resets the review session. */
  function refresh(): void {
    build();
    updateMeta();
    renderPhases(); renderLegend(); fit(); render(); renderDif(); renderInfo(); updateProgress(); updateEmpty();
  }

  function updateMeta(): void {
    const total = Object.keys(ctx.state.nodes).length;
    const resolved = plan.changes.filter((chg) => chg.target.kind === 'node' && ctx.state.nodes[chg.target.ref]).length;
    $('plMeta').innerHTML = `base <b>${esc(plan.base || '—')}</b> · map <b>${total}</b> nodes · plan <b>${plan.changes.length}</b> changes · <b>${plan.changes.filter((chg) => chg.status === 'modify').length}</b> modify · <b>${plan.changes.filter((chg) => chg.status === 'add').length}</b> new · ${resolved} resolved`;
    $('plBase').textContent = plan.base || '—';
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
    if (ctx.plan) plan = ctx.plan;
    ctx.runtime.plannerVisible = true;
    overlay.classList.add('show');
    overlay.focus();
    refresh();
  }
  /** D2 — open the unified surface to review a raw proposal .mmd (diff vs current). */
  function openProposal(): void {
    if (ctx.plan) plan = ctx.plan;
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
  $('plExport').onclick = doExport;
  $('plSwitch').onclick = togglePlan;

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
  wrap.addEventListener('mousedown', (ev) => { if ((ev.target as HTMLElement).closest('.pl-nodeg')) return; dr = true; moved = false; sx = ev.clientX; sy = ev.clientY; ox = tx; oy = ty; wrap.classList.add('pan'); });
  window.addEventListener('mousemove', (ev) => { if (!dr) return; tx = ox + (ev.clientX - sx); ty = oy + (ev.clientY - sy); if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true; applyT(); });
  window.addEventListener('mouseup', () => { dr = false; wrap.classList.remove('pan'); });
  wrap.addEventListener('click', (ev) => { if (!(ev.target as HTMLElement).closest('.pl-nodeg') && !moved) select(null); });
  $('plSvg').addEventListener('wheel', (ev) => {
    ev.preventDefault(); const bbox = wrap.getBoundingClientRect(); const mx = ev.clientX - bbox.left, my = ev.clientY - bbox.top;
    if (ev.ctrlKey || ev.metaKey) { const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1; const wx = (mx - tx) / k, wy = (my - ty) / k; k = Math.max(0.2, Math.min(2.4, k * factor)); tx = mx - wx * k; ty = my - wy * k; }
    else { tx -= (ev as WheelEvent).deltaX; ty -= (ev as WheelEvent).deltaY; }
    applyT();
  }, { passive: false });
  overlay.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (level !== null) toTop(); else close(); } });
  overlay.tabIndex = -1;
  window.addEventListener('resize', () => { if (overlay.classList.contains('show')) fit(); });

  return { open, openProposal, close };
}
