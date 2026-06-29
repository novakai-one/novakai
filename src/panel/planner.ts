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

import type { AppContext } from '../core/context/context';
import type { DiagramNode, DiagramEdge } from '../core/types/types';
import type { MermaidApi } from '../io/mermaid';
import { childIdsOf, containerOf } from '../core/state/state';
import { frontmatterToMermaid } from '../core/frontmatter/frontmatter';
import {
  normalizePlan, indexByRef, indexById, downstreamCone, coherenceWarnings, synthNode, applyPlan,
  type Plan, type PlanChange, type Verdict,
} from '../core/plan/plan';
import type { Frontmatter } from '../core/types/types';

export interface PlannerApi {
  open: () => void;
  close: () => void;
}

const NS = 'http://www.w3.org/2000/svg';

const KIND_FILL: Record<string, string> = {
  module: '#39456b', function: '#2d3a59', type: '#473a5d', store: '#3a4d48',
  service: '#3a4d48', hook: '#2d3a59', class: '#39456b', component: '#39456b', event: '#3a4d48',
};
const STATUS_COL: Record<string, string> = { existing: '#566089', add: '#5bd6a0', modify: '#e0a44a', remove: '#e06a6a' };

const CSS = `
.pl-overlay{position:fixed;inset:0;z-index:60;display:none;background:#0e1016;color:#e6e9f0;
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
    const s = synth[id];
    return !!s && (s.parent ?? null) === container;
  };

  /* ---- which nodes live at the current level ---- */
  function levelNodes(): string[] {
    const real = childIdsOf(ctx.state, level).filter((id) => ctx.state.nodes[id].shape !== 'group');
    const syn = Object.keys(synth).filter((id) => isSynthChild(id, level));
    return [...real, ...syn];
  }

  /* ---- section caption for a drilled child (its group parent label) ---- */
  function sectionOf(id: string): string {
    const p = ctx.state.nodes[id]?.parent;
    if (p && ctx.state.nodes[p]?.shape === 'group') return ctx.state.nodes[p].label;
    return '';
  }

  /* =================== layout =================== */
  function layoutLevel(): Record<string, { x: number; y: number }> {
    const key = level ?? '__top__';
    if (posCache[key]) return posCache[key];
    const ids = levelNodes();
    const pos: Record<string, { x: number; y: number }> = {};
    if (level === null) {
      forceLayout(ids, pos);
    } else {
      // group by section, stacked rows of 3
      const secs = new Map<string, string[]>();
      ids.forEach((id) => { const s = sectionOf(id); if (!secs.has(s)) secs.set(s, []); secs.get(s)!.push(id); });
      let y = 60;
      for (const [, members] of secs) {
        members.forEach((id, i) => { pos[id] = { x: 40 + (i % 3) * 220, y: y + Math.floor(i / 3) * 78 }; });
        y += Math.ceil(members.length / 3) * 78 + 44;
      }
    }
    posCache[key] = pos;
    return pos;
  }

  /** Tiny force sim for the top level (seeded from real x/y when present). */
  function forceLayout(ids: string[], pos: Record<string, { x: number; y: number }>): void {
    const N = ids.map((id, i) => {
      const n = node(id)!;
      const seedX = n.x || (200 + Math.cos(i) * 320);
      const seedY = n.y || (200 + Math.sin(i * 1.3) * 280);
      return { id, x: seedX * 0.15 + 200 + Math.cos(i) * 300, y: seedY * 0.1 + 200 + Math.sin(i * 1.3) * 260, vx: 0, vy: 0 };
    });
    const idset = new Set(ids);
    const E = ctx.state.edges.filter((e) => idset.has(e.from) && idset.has(e.to));
    const idx: Record<string, typeof N[number]> = {};
    N.forEach((n) => { idx[n.id] = n; });
    for (let it = 0; it < 300; it++) {
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01;
        const f = 44000 / d2; const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      E.forEach((e) => {
        const a = idx[e.from], b = idx[e.to]; if (!a || !b) return;
        let dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const rest = e.style === 'dotted' ? 270 : 200; const f = (d - rest) * 0.02; dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      });
      N.forEach((n) => {
        n.vx += (440 - n.x) * 0.002; n.vy += (360 - n.y) * 0.002;
        n.x += Math.max(-18, Math.min(18, n.vx)); n.y += Math.max(-18, Math.min(18, n.vy));
        n.vx *= 0.86; n.vy *= 0.86;
      });
    }
    N.forEach((n) => { pos[n.id] = { x: n.x, y: n.y }; });
    // park new top-level nodes in a column to the right
    const xs = N.map((n) => n.x); const maxx = xs.length ? Math.max(...xs) : 400;
    let pi = 0;
    ids.filter((id) => synth[id]).forEach((id) => { pos[id] = { x: maxx + 260, y: 120 + pi * 120 }; pi++; });
  }

  /* =================== camera =================== */
  function applyT(): void { $('plWorld').setAttribute('transform', `translate(${tx},${ty}) scale(${k})`); }
  function fit(): void {
    const wrap = $('plCanvas'); const W = wrap.clientWidth, H = wrap.clientHeight;
    const pos = layoutLevel(); const ps = Object.values(pos); if (!ps.length) { applyT(); return; }
    const pad = 80;
    const x0 = Math.min(...ps.map((p) => p.x)) - pad, x1 = Math.max(...ps.map((p) => p.x)) + 180 + pad;
    const y0 = Math.min(...ps.map((p) => p.y)) - pad, y1 = Math.max(...ps.map((p) => p.y)) + 60 + pad;
    k = Math.min(W / (x1 - x0), H / (y1 - y0), 1.4);
    tx = (W - (x1 - x0) * k) / 2 - x0 * k; ty = (H - (y1 - y0) * k) / 2 - y0 * k; applyT();
  }
  /* =================== render =================== */
  function render(): void {
    const ng = $('plNodes'), eg = $('plEdges'); ng.innerHTML = ''; eg.innerHTML = '';
    const ids = levelNodes(); const idset = new Set(ids); const pos = layoutLevel();
    const W = 180, H = level === null ? 54 : 46;
    const center = (id: string): { x: number; y: number } => { const p = pos[id] || { x: 0, y: 0 }; return { x: p.x + W / 2, y: p.y + H / 2 }; };

    // focus set (selection lights direct neighbours)
    let lit: Set<string> | null = null;
    if (sel && idset.has(sel)) {
      lit = new Set([sel]);
      ctx.state.edges.forEach((e) => { if (e.from === sel && idset.has(e.to)) lit!.add(e.to); if (e.to === sel && idset.has(e.from)) lit!.add(e.from); });
    }

    // real edges within level
    ctx.state.edges.forEach((e) => {
      if (!idset.has(e.from) || !idset.has(e.to)) return;
      const A = center(e.from), B = center(e.to); const mx = (A.x + B.x) / 2;
      const p = el('path'); p.setAttribute('d', `M${A.x},${A.y} C ${mx},${A.y} ${mx},${B.y} ${B.x},${B.y}`);
      const dim = lit && !(lit.has(e.from) && lit.has(e.to));
      p.setAttribute('class', 'pl-edge ' + (dim ? 'pl-faded' : 'pl-full'));
      p.setAttribute('stroke', e.style === 'dotted' ? '#39426b' : '#54608a');
      if (e.style === 'dotted') p.setAttribute('stroke-dasharray', '4 4');
      eg.appendChild(p);
    });

    // plan EDGE changes within level (ghost edges, selectable)
    if (planOn) {
      plan.changes.filter((c) => c.target.kind === 'edge' && c.newEdge).forEach((c) => {
        const { from, to } = c.newEdge!;
        if (!idset.has(from) || !idset.has(to)) return;
        const A = center(from), B = center(to); const mx = (A.x + B.x) / 2;
        const p = el('path'); p.setAttribute('d', `M${A.x},${A.y} C ${mx},${A.y} ${mx},${B.y} ${B.x},${B.y}`);
        p.setAttribute('class', 'pl-edge pl-nodeg ' + (phaseFocus && c.phase !== phaseFocus ? 'pl-faded' : 'pl-full'));
        p.setAttribute('stroke', STATUS_COL[c.status]); p.setAttribute('stroke-width', '2.4'); p.setAttribute('stroke-dasharray', '7 4');
        if (sel === c.target.ref) p.setAttribute('stroke-width', '3.4');
        p.addEventListener('click', (ev) => { ev.stopPropagation(); select(c.target.ref); });
        eg.appendChild(p);
      });

      // dependency arrows between visible change nodes (amber dashed)
      plan.changes.forEach((c) => {
        if (!c.dependsOn?.length || c.target.kind !== 'node' || !idset.has(c.target.ref)) return;
        c.dependsOn.forEach((depId) => {
          const dep = byId[depId]; if (!dep || dep.target.kind !== 'node' || !idset.has(dep.target.ref)) return;
          const A = center(dep.target.ref), B = center(c.target.ref); const mx = (A.x + B.x) / 2;
          const p = el('path'); p.setAttribute('d', `M${A.x},${A.y} C ${mx},${A.y} ${mx},${B.y} ${B.x},${B.y}`);
          p.setAttribute('class', 'pl-edge pl-full'); p.setAttribute('stroke', '#7a6a3a'); p.setAttribute('stroke-dasharray', '2 5'); p.setAttribute('stroke-width', '1.6');
          eg.appendChild(p);
        });
      });
    }

    const warns = new Set(coherenceWarnings(plan, verdicts).map((w) => w.changeId));

    ids.forEach((id) => {
      const n = node(id)!; const p = pos[id] || { x: 0, y: 0 };
      const ch = planOn ? byRef[id] : undefined;
      const g = el('g');
      let dim = (!!lit && !lit.has(id)) || (planOn && !!phaseFocus && !!ch && ch.phase !== phaseFocus) || (planOn && !!phaseFocus && !ch && id !== sel);
      g.setAttribute('class', 'pl-nodeg ' + (dim ? 'pl-faded' : 'pl-full'));
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
      const r = el('rect'); r.setAttribute('width', String(W)); r.setAttribute('height', String(H)); r.setAttribute('rx', '9');
      r.setAttribute('fill', ch ? (ch.status === 'add' ? '#16332544' : ch.status === 'remove' ? '#33161644' : '#33301644') : (KIND_FILL[n.kind ?? 'module'] || KIND_FILL.module));
      r.setAttribute('stroke', ch ? STATUS_COL[ch.status] : '#2a3042'); r.setAttribute('stroke-width', ch ? '2' : '1.5');
      g.appendChild(r);
      if (ch) { const pip = el('rect'); pip.setAttribute('width', '5'); pip.setAttribute('height', String(H)); pip.setAttribute('rx', '2'); pip.setAttribute('fill', STATUS_COL[ch.status]); g.appendChild(pip); }
      const t = el('text'); t.setAttribute('x', '14'); t.setAttribute('y', level === null ? '23' : '20'); t.setAttribute('class', 'pl-text'); t.setAttribute('font-size', '13'); t.setAttribute('font-weight', '600'); t.textContent = n.label; g.appendChild(t);
      const sub = el('text'); sub.setAttribute('x', '14'); sub.setAttribute('y', level === null ? '41' : '36'); sub.setAttribute('class', 'pl-text'); sub.setAttribute('font-size', '9.5'); sub.setAttribute('fill', '#8b93a7');
      const nfn = childIdsOf(ctx.state, id).filter((c) => ctx.state.nodes[c].shape !== 'group').length;
      sub.textContent = ch ? (ch.status.toUpperCase() + (ch.phase ? ' · P' + ch.phase : '')) : (synth[id] ? 'new · ' + (n.kind ?? 'module') : (n.kind ?? '') + (level === null && nfn ? ` · ${nfn} fns` : ''));
      g.appendChild(sub);
      if (warns.has(byRef[id]?.id ?? '')) { const w = el('text'); w.setAttribute('x', String(W - 11)); w.setAttribute('y', '17'); w.setAttribute('text-anchor', 'end'); w.setAttribute('class', 'pl-text'); w.setAttribute('font-size', '13'); w.setAttribute('fill', '#e06a6a'); w.textContent = '⚠'; g.appendChild(w); }
      else if (ch && verdicts[ch.id]) { const vm = el('text'); vm.setAttribute('x', String(W - 11)); vm.setAttribute('y', '17'); vm.setAttribute('text-anchor', 'end'); vm.setAttribute('class', 'pl-text'); vm.setAttribute('font-size', '13'); vm.setAttribute('fill', verdicts[ch.id] === 'accept' ? '#5bd6a0' : '#e06a6a'); vm.textContent = verdicts[ch.id] === 'accept' ? '✓' : '✕'; g.appendChild(vm); }
      if (sel === id) { const sr = el('rect'); sr.setAttribute('class', 'pl-seln'); sr.setAttribute('x', '-4'); sr.setAttribute('y', '-4'); sr.setAttribute('width', String(W + 8)); sr.setAttribute('height', String(H + 8)); sr.setAttribute('rx', '12'); g.appendChild(sr); }
      g.addEventListener('click', (ev) => { ev.stopPropagation(); select(id); });
      g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); if (level === null && nfn) drill(id); });
      ng.appendChild(g);
    });

    // crumb
    if (level === null) $('plCrumb').innerHTML = `<b>top level</b> · ${ids.length} modules`;
    else $('plCrumb').innerHTML = `<span class="pl-crumblink" id="plToTop">top level</span> › <b>${node(level)!.label}</b> · ${ids.length} units`;
    const tt = document.getElementById('plToTop'); if (tt) tt.onclick = toTop;

    // coherence banner
    const cw = coherenceWarnings(plan, verdicts);
    const banner = $('plWarnBanner');
    if (cw.length) { banner.style.display = 'block'; banner.textContent = `⚠ ${cw.length} incoherent verdict${cw.length > 1 ? 's' : ''}: ` + cw.map((w) => w.changeId).join(', '); }
    else banner.style.display = 'none';
  }

  /* =================== drill =================== */
  function drill(id: string): void { level = id; sel = null; fit(); render(); renderInfo(); }
  function toTop(): void { level = null; sel = null; fit(); render(); renderInfo(); }

  /* =================== select + info =================== */
  function select(ref: string | null): void { sel = ref; render(); renderInfo(); renderDif(); }

  function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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
      const nMod = plan.changes.filter((c) => c.status === 'modify').length;
      const nAdd = plan.changes.filter((c) => c.status === 'add').length;
      box.innerHTML = `<div class="pl-empty"><b style="color:#8b93a7">Build plan over the real map.</b><br>${plan.changes.length} changes · ${nMod} modify existing · ${nAdd} new.<br><br>Click a node or a diff line → intent + accept/reject.<br><br><span style="color:#e0a44a">amber</span>=modify · <span style="color:#5bd6a0">green</span>=new · <span style="color:#e06a6a">red</span>=remove.</div>`;
      return;
    }
    const ch = planOn ? byRef[sel] : undefined;
    if (ch) { renderChangeInfo(box, ch); return; }
    // plain existing node
    const n = node(sel);
    if (!n) { box.innerHTML = `<div class="pl-empty">${esc(sel)}</div>`; return; }
    const f = n.fm; const i0 = f?.interfaces?.[0];
    const sig = f ? `<pre class="pl-sig">${esc((f.name || n.id) + (i0?.name ? '.' + i0.name : '') + '(' + (i0?.accepts?.join(', ') || '') + ')' + (i0?.returns?.length ? ' → ' + i0.returns.join(' | ') : '') + (f.state?.length ? '\nstate: ' + f.state.join('; ') : ''))}</pre>` : '';
    const nfn = childIdsOf(ctx.state, n.id).filter((c) => ctx.state.nodes[c].shape !== 'group').length;
    const body = bodyOf(n.id);
    const codeToday = body ? `<div class="pl-field"><div class="pl-flabel">source</div><pre class="pl-body">${esc(body)}</pre></div>` : '';
    box.innerHTML = `<div class="pl-ihd"><span class="pl-tag existing">EXISTING</span><span class="pl-tag kind">${esc(n.kind ?? '')}</span><span class="pl-ititle">${esc(n.label)}</span></div>
      ${f?.description ? `<div class="pl-field"><div class="pl-flabel">desc</div><div class="pl-ftext">${esc(f.description)}</div></div>` : ''}
      ${sig}
      ${codeToday}
      ${nfn ? `<div class="pl-field" style="margin-top:10px"><div class="pl-flabel">drill-in</div><div class="pl-ftext">${nfn} units — double-click to open</div></div>` : ''}
      <div class="pl-meta" style="margin-top:10px">real node · ${byRef[n.id] ? 'in plan' : 'not touched by this plan'}</div>`;
  }

  function renderChangeInfo(box: HTMLElement, ch: PlanChange): void {
    const isEdge = ch.target.kind === 'edge';
    const target = node(ch.target.ref);
    const title = isEdge ? (ch.newEdge ? `${ch.newEdge.from} → ${ch.newEdge.to}` : ch.target.ref) : (target?.label ?? ch.target.ref);
    const phaseTxt = ch.phase ? 'P' + ch.phase : '';
    const real = !isEdge && !!ctx.state.nodes[ch.target.ref];
    const quote = ch.quoteReal && target?.fm?.description
      ? `<div class="pl-field"><div class="pl-flabel">real code today</div><div class="pl-quote">${esc((target.fm.name || ch.target.ref) + ' — ' + target.fm.description)}</div></div>` : '';
    const opt = (label: string, v?: string): string => v ? `<div class="pl-field"><div class="pl-flabel">${label}</div><div class="pl-ftext">${esc(v)}</div></div>` : '';

    // transitive blast radius for a node change (the real downstream cone)
    let blast = '';
    if (!isEdge && real) {
      const cone = downstreamCone(ctx.state.edges, ch.target.ref, { roots: ctx.state.roots });
      if (cone.affected.length) {
        const direct = cone.affected.filter((a) => a.depth === 1).length;
        const chips = cone.affected.slice(0, 12).map((a) =>
          `<span class="pl-chip" data-ref="${esc(a.id)}" title="${a.depth} hop${a.depth > 1 ? 's' : ''} downstream">${esc(node(a.id)?.label ?? a.id)}${a.depth > 1 ? ` ·${a.depth}` : ''}</span>`).join('');
        const more = cone.affected.length > 12 ? `<span class="pl-chip" style="cursor:default;background:none;color:#5a6275">+${cone.affected.length - 12} more</span>` : '';
        const ep = cone.entryPoints.length ? ` · reaches ${cone.entryPoints.length} entry point${cone.entryPoints.length > 1 ? 's' : ''}` : '';
        blast = `<div class="pl-field"><div class="pl-flabel">blast radius · ${cone.affected.length} affected${direct < cone.affected.length ? ` (${direct} direct, depth ≤ ${cone.maxDepth})` : ''}${ep}</div><div class="pl-chips">${chips}${more}</div></div>`;
      }
    }

    // before/after public signature — present when the change proposes a new fm.
    // This is the contract the reviewer is actually approving (Phase 1b).
    let sigBlock = '';
    if (!isEdge && ch.fm) {
      const after = sigLine(ch.fm, ch.target.ref);
      const before = ch.status === 'modify' ? sigLine(target?.fm, ch.target.ref) : null;
      sigBlock = `<div class="pl-field"><div class="pl-flabel">contract · signature</div><div class="pl-baf">`
        + (before ? `<div class="row before"><span class="lab">before</span><code>${esc(before)}</code></div>` : '')
        + `<div class="row after"><span class="lab">${before ? 'after' : 'new'}</span><code>${esc(after)}</code></div></div></div>`;
    }

    // real code today — for a modify, surface the actual source body (PLANNER_HANDOVER #3),
    // so the reviewer judges the change against real code, not the AI's prose.
    let codeBlock = '';
    if (!isEdge && ch.status === 'modify') {
      const body = bodyOf(ch.target.ref);
      if (body) codeBlock = `<div class="pl-field"><div class="pl-flabel">code today</div><pre class="pl-body">${esc(body)}</pre></div>`;
    }
    // dependencies
    let deps = '';
    if (ch.dependsOn?.length) {
      const chips = ch.dependsOn.map((d) => { const dc = byId[d]; const v = verdicts[d]; const mark = v === 'reject' ? ' ✕' : v === 'accept' ? ' ✓' : ''; return `<span class="pl-chip" data-change="${esc(d)}">${esc(dc?.target.ref ?? d)}${mark}</span>`; }).join('');
      deps = `<div class="pl-field"><div class="pl-flabel">depends on</div><div class="pl-chips">${chips}</div></div>`;
    }

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

    box.querySelectorAll<HTMLElement>('.pl-vbtn').forEach((b) => { b.onclick = () => setVerdict(ch.id, b.dataset.v as Verdict); });
    box.querySelectorAll<HTMLElement>('.pl-chip[data-ref]').forEach((c) => { c.onclick = () => focusRef(c.dataset.ref!); });
    box.querySelectorAll<HTMLElement>('.pl-chip[data-change]').forEach((c) => { c.onclick = () => { const t = byId[c.dataset.change!]; if (t) focusRef(t.target.ref); }; });
  }

  /** Jump selection to a ref, drilling out to the level it lives on if needed. */
  function focusRef(ref: string): void {
    const n = node(ref);
    if (n) {
      const lvl = ctx.state.nodes[ref] ? containerOf(ctx.state, ref) : (synth[ref]?.parent ?? null);
      if (lvl !== level) { level = lvl; fit(); }
    }
    select(ref);
  }

  function setVerdict(changeId: string, v: Verdict): void {
    verdicts[changeId] = verdicts[changeId] === v ? undefined : v;
    render(); renderInfo(); renderDif(); updateProgress();
  }

  /* =================== diff list =================== */
  function renderDif(): void {
    const box = $('plDif');
    const warns = new Set(coherenceWarnings(plan, verdicts).map((w) => w.changeId));
    const lines: string[] = [];
    const order = [...plan.changes].sort((a, b) => (a.phase ?? 9) - (b.phase ?? 9));
    let curPhase = -1;
    order.forEach((c) => {
      if ((c.phase ?? 9) !== curPhase) {
        curPhase = c.phase ?? 9;
        const ph = plan.phases?.find((p) => p.id === curPhase);
        lines.push(`<div class="pl-ln" style="cursor:default;color:#5a6275;background:none">${esc(ph ? '— ' + ph.title + ' —' : '— phase ' + curPhase + ' —')}</div>`);
      }
      const pfx = c.status === 'add' ? '+' : c.status === 'remove' ? '−' : '~';
      const selCls = c.target.ref === sel ? ' sel' : '';
      const v = verdicts[c.id]; const vd = v === 'accept' ? '<span class="vd a">✓</span>' : v === 'reject' ? '<span class="vd r">✕</span>' : '';
      const incoh = warns.has(c.id) ? '<span class="incoh">⚠</span>' : '';
      const what = c.target.kind === 'edge' ? (c.newEdge ? `${c.newEdge.from}→${c.newEdge.to}` : c.target.ref) : c.target.ref;
      lines.push(`<div class="pl-ln ${c.status}${selCls}" data-ref="${esc(c.target.ref)}"><span class="pv">${pfx}</span>${esc(what)} <span style="color:#5a6275">· ${esc(c.intent.approach.slice(0, 48))}…</span>${incoh}${vd}</div>`);
    });
    box.innerHTML = lines.join('');
    box.querySelectorAll<HTMLElement>('.pl-ln[data-ref]').forEach((ln) => { ln.onclick = () => focusRef(ln.dataset.ref!); });
    const s = box.querySelector('.pl-ln.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }

  /* =================== phases =================== */
  function renderPhases(): void {
    const ph = plan.phases ?? [];
    $('plPhases').innerHTML = ph.map((p) => {
      const n = plan.changes.filter((c) => c.phase === p.id).length;
      return `<div class="pl-phase ${phaseFocus === p.id ? 'on' : ''}" data-p="${p.id}"><span class="n">${esc(p.subtitle ?? '')}</span><span class="t">${esc(p.title)}</span><span class="c">${n} changes</span></div>`;
    }).join('');
    $('plPhases').querySelectorAll<HTMLElement>('.pl-phase').forEach((d) => { d.onclick = () => { const id = +d.dataset.p!; phaseFocus = phaseFocus === id ? null : id; renderPhases(); render(); }; });
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
    const done = plan.changes.filter((c) => verdicts[c.id]).length;
    const acc = plan.changes.filter((c) => verdicts[c.id] === 'accept').length;
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
    for (const id of ids) { const k = model.nodes[id].kind; if (k) out += `%% kind ${id} ${k}\n`; }
    for (const id of ids) {
      const p = model.nodes[id].parent;
      if (p && model.nodes[p] && model.nodes[p].shape !== 'group') out += `%% parent ${id} ${p}\n`;
    }
    for (const id of ids) { const n = model.nodes[id]; if (n.shape !== 'group') out += `  ${id}["${n.label.replace(/"/g, '')}"]\n`; }
    const arrow: Record<string, string> = { solid: '-->', thick: '==>', dotted: '-.->' };
    for (const e of model.edges) out += `  ${e.from} ${arrow[e.style] || '-->'} ${e.to}\n`;
    return out;
  }

  function downloadText(filename: string, text: string): void {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function doExport(): void {
    const total = plan.changes.length, done = plan.changes.filter((c) => verdicts[c.id]).length;
    if (done < total || coherenceWarnings(plan, verdicts).length) { ctx.hooks.toast('Resolve all changes + coherence first'); return; }
    const isAcc = (id: string): boolean => verdicts[id] === 'accept';
    const accepted = plan.changes.filter((c) => isAcc(c.id));

    // the approved spec = base map + accepted adds / removes / fm-mutations. This is
    // the real artifact the deterministic pipeline (spec-to-stubs + gate) enforces.
    const model = applyPlan(ctx.state, plan, isAcc);
    downloadText('approved-spec.mmd', serializeSpec(model));

    // the build checklist — exactly what the gate flags as "unbuilt" until coded.
    const newNodes = accepted.filter((c) => c.status === 'add' && c.target.kind === 'node').length;
    const newEdges = accepted.filter((c) => c.status === 'add' && c.target.kind === 'edge').length;
    const mods = accepted.filter((c) => c.status === 'modify').length;
    const removes = accepted.filter((c) => c.status === 'remove').length;
    const withSig = accepted.filter((c) => c.fm).length;

    $('plS3').className = 'pl-step done'; $('plS4').className = 'pl-step active';
    $('plVmsg').innerHTML = `<b style="color:#5bd6a0">approved-spec.mmd</b> downloaded · ${newNodes} new + ${mods} modified → run <code>spec:stubs</code> then <code>flowmap:gate</code>`;
    ctx.hooks.toast(`Approved spec: ${newNodes} new node(s), ${newEdges} edge(s), ${mods} modify, ${removes} remove · ${withSig} carry a signature contract`);
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
    plan.changes.forEach((c) => { const sn = synthNode(c); if (sn && !ctx.state.nodes[sn.id]) synth[sn.id] = sn; });
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

  async function loadSample(): Promise<void> {
    try {
      const r = await fetch('plan.json');
      if (!r.ok) { ctx.hooks.toast('No sample plan.json found'); return; }
      ctx.plan = normalizePlan(await r.json()); plan = ctx.plan; refresh();
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
    const resolved = plan.changes.filter((c) => c.target.kind === 'node' && ctx.state.nodes[c.target.ref]).length;
    $('plMeta').innerHTML = `base <b>${esc(plan.base || '—')}</b> · map <b>${total}</b> nodes · plan <b>${plan.changes.length}</b> changes · <b>${plan.changes.filter((c) => c.status === 'modify').length}</b> modify · <b>${plan.changes.filter((c) => c.status === 'add').length}</b> new · ${resolved} resolved`;
    $('plBase').textContent = plan.base || '—';
  }

  /** Show a guided empty state when there's no base map (nothing to review against). */
  function updateEmpty(): void {
    const noBase = Object.keys(ctx.state.nodes).length === 0;
    const box = $('plEmpty');
    if (!noBase) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    $('plEmptyTitle').textContent = 'No base map loaded';
    $('plEmptyMsg').innerHTML = 'A plan is reviewed against your architecture map. Load the repo’s <b>.mmd</b> (your full map, e.g. <b>docs/flowmap/_bundle.mmd</b>) — the AI’s plan patch then overlays on it. The plan itself is a small JSON of changes, loaded separately.';
    $('plEmptyActions').innerHTML = `<button class="pl-btn go" id="plEmptyBase">Load .mmd…</button><button class="pl-btn" id="plEmptyBasePaste">Paste base map</button>`;
    ($('plEmptyBase')).onclick = () => ($('plBaseFile') as HTMLInputElement).click();
    ($('plEmptyBasePaste')).onclick = () => openPaste('base');
  }

  /* =================== paste panel =================== */
  let pasteMode: 'base' | 'plan' = 'base';
  function openPaste(mode: 'base' | 'plan'): void {
    pasteMode = mode;
    $('plPasteTitle').textContent = mode === 'base' ? 'Paste base map (.mmd)' : 'Paste plan patch (.json)';
    $('plPasteSub').textContent = mode === 'base' ? 'your full architecture map text' : 'the small JSON of proposed changes';
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
    } else {
      try { loadPlanFromText(text); closePaste(); }
      catch (e) { $('plPasteErr').textContent = 'Invalid plan JSON: ' + (e instanceof Error ? e.message : String(e)); }
    }
  }

  /* =================== open / close =================== */
  function open(): void {
    if (ctx.plan) plan = ctx.plan;
    overlay.classList.add('show');
    overlay.focus();
    refresh();
  }
  function close(): void { overlay.classList.remove('show'); }

  /* =================== wire DOM =================== */
  $('plClose').onclick = close;
  $('plExport').onclick = doExport;
  $('plSwitch').onclick = togglePlan;

  // loaders
  ($('plBaseFile') as HTMLInputElement).onchange = (e) => {
    const inp = e.target as HTMLInputElement; const f = inp.files?.[0]; if (!f) return;
    f.text().then((t) => { if (!loadBaseFromText(t)) ctx.hooks.toast('No nodes parsed from that .mmd'); else ctx.hooks.toast('Base map loaded'); });
    inp.value = '';
  };
  ($('plPlanFile') as HTMLInputElement).onchange = (e) => {
    const inp = e.target as HTMLInputElement; const f = inp.files?.[0]; if (!f) return;
    f.text().then((t) => { try { loadPlanFromText(t); ctx.hooks.toast('Plan loaded'); } catch (err) { ctx.hooks.toast('Invalid plan JSON: ' + (err instanceof Error ? err.message : String(err))); } });
    inp.value = '';
  };
  $('plBasePaste').onclick = () => openPaste('base');
  $('plPlanPaste').onclick = () => openPaste('plan');
  $('plSample').onclick = () => { void loadSample(); };
  $('plPasteClose').onclick = closePaste;
  $('plPasteParse').onclick = doPasteParse;

  const wrap = $('plCanvas');
  let dr = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
  wrap.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('.pl-nodeg')) return; dr = true; moved = false; sx = e.clientX; sy = e.clientY; ox = tx; oy = ty; wrap.classList.add('pan'); });
  window.addEventListener('mousemove', (e) => { if (!dr) return; tx = ox + (e.clientX - sx); ty = oy + (e.clientY - sy); if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true; applyT(); });
  window.addEventListener('mouseup', () => { dr = false; wrap.classList.remove('pan'); });
  wrap.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.pl-nodeg') && !moved) select(null); });
  $('plSvg').addEventListener('wheel', (e) => {
    e.preventDefault(); const r = wrap.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey) { const f = e.deltaY < 0 ? 1.1 : 1 / 1.1; const wx = (mx - tx) / k, wy = (my - ty) / k; k = Math.max(0.2, Math.min(2.4, k * f)); tx = mx - wx * k; ty = my - wy * k; }
    else { tx -= (e as WheelEvent).deltaX; ty -= (e as WheelEvent).deltaY; }
    applyT();
  }, { passive: false });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (level !== null) toTop(); else close(); } });
  overlay.tabIndex = -1;
  window.addEventListener('resize', () => { if (overlay.classList.contains('show')) fit(); });

  return { open, close };
}
