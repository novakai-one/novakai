/* =====================================================================
   planner-info.ts — the reviewer's SIDE PANEL + verdict flow: the intent
   panel (existing node / change), signature/blast/depends/code blocks,
   accept-reject verdicts, the architectural diff list, phase strip, legend,
   progress, and the gated export — split out of planner.ts in place. Every
   symbol here used to be a closure over initPlanner's locals; those locals
   now live on the shared `E: PEnv` object planner.ts constructs and passes
   to every sibling factory, and this factory attaches its own functions back
   onto `E` so the other siblings (and planner.ts itself) can call them.
   ===================================================================== */

import type { DiagramNode, DiagramEdge, Frontmatter } from '../../core/types/types';
import { childIdsOf, containerOf } from '../../core/state/state';
import { frontmatterToMermaid } from '../../core/frontmatter/frontmatter';
import {
  downstreamCone, coherenceWarnings, applyPlan,
  type Plan, type PlanChange, type PlanPhase, type Verdict,
  type ConeNode,
} from '../../core/plan/plan';
import type { PEnv } from './planner';

// Overlay stylesheet (shell + canvas + side-panel/diff rules), injected once by planner.ts.
// Lives here because the majority of these rules style the info panel and diff list.
export const PLANNER_CSS = `
.pl-overlay{position:fixed;inset:0;z-index:80;display:none;background:#0e1016;color:#e6e9f0;
  font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace;font-size:13px}.pl-overlay.show{display:grid;
grid-template-columns:1fr 420px;grid-template-rows:auto auto 1fr auto;height:100vh}.pl-hd{grid-column:1/3;display:flex;
align-items:center;gap:14px;padding:9px 16px;background:#13161f;border-bottom:1px solid #2a3042}
.pl-brand{font-weight:700}.pl-brand b{color:#7aa2ff}.pl-meta{color:#5a6275;font-size:11px;line-height:1.4}
.pl-meta b{color:#8b93a7}.pl-tg{margin-left:auto;display:flex;align-items:center;gap:10px}.pl-switch{display:flex;
align-items:center;gap:7px;cursor:pointer;color:#8b93a7;padding:6px 11px;border:1px solid #2a3042;border-radius:8px;
user-select:none}.pl-switch.on{border-color:#5bd6a0;color:#5bd6a0;background:#10231a}.pl-pbar{width:130px;height:8px;
border-radius:5px;background:#1c2030;overflow:hidden}.pl-pfill{height:100%;width:0;
background:linear-gradient(90deg,#3a7a5a,#5bd6a0);transition:width .3s}.pl-btn{padding:7px 12px;border-radius:8px;
border:1px solid #2a3042;background:#1c2030;color:#e6e9f0;cursor:pointer;font:inherit;font-size:12px}
.pl-btn:hover{border-color:#7aa2ff}.pl-btn.go{background:#7aa2ff;color:#0a0c12;font-weight:700;border:0}
.pl-btn.go:disabled{background:#2a3042;color:#5a6275;cursor:not-allowed}.pl-load{display:flex;align-items:center;
gap:6px}.pl-load .pl-btn{padding:5px 9px;font-size:11px}.pl-paste{position:absolute;inset:0;background:#0c0e14ee;
z-index:8;display:flex;flex-direction:column;padding:18px;gap:10px}.pl-paste-hd{display:flex;align-items:center;
gap:10px;color:#e6e9f0;font-weight:700}.pl-paste-hd .sub{font-weight:400;color:#5a6275;font-size:11px}
.pl-paste-hd button{margin-left:auto}.pl-paste textarea{flex:1;background:#0e1016;border:1px solid #2a3042;
border-radius:8px;color:#c9d2e6;font-family:inherit;font-size:12px;padding:10px;resize:none}
.pl-paste-err{color:#e06a6a;font-size:11px;min-height:14px}.pl-emptystate{position:absolute;inset:0;display:flex;
flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#8b93a7;text-align:center;padding:30px}
.pl-emptystate h3{margin:0;color:#e6e9f0;font-size:16px}.pl-emptystate .row{display:flex;gap:10px}
.pl-phases{grid-column:1/3;display:flex;background:#11141c;border-bottom:1px solid #2a3042;min-height:46px}
.pl-phase{flex:1;display:flex;flex-direction:column;justify-content:center;padding:6px 16px;
border-right:1px solid #2a3042;cursor:pointer;position:relative;color:#8b93a7}.pl-phase:hover{background:#161b27}
.pl-phase.on{background:#1a2030;color:#e6e9f0}.pl-phase .n{font-size:9px;letter-spacing:1px;color:#5a6275}
.pl-phase .t{font-weight:600;font-size:12px}.pl-phase .c{position:absolute;right:12px;top:50%;
transform:translateY(-50%);font-size:10px;color:#5a6275}.pl-canvaswrap{grid-row:3;grid-column:1;position:relative;
overflow:hidden;background:#0e1016;cursor:grab}.pl-canvaswrap.pan{cursor:grabbing}.pl-svg{width:100%;height:100%}
.pl-crumb{position:absolute;left:14px;top:12px;display:flex;gap:6px;align-items:center;color:#8b93a7;font-size:12px;
z-index:5}.pl-crumb b{color:#e6e9f0}.pl-crumblink{cursor:pointer;color:#7aa2ff}.pl-legend{position:absolute;left:14px;
bottom:12px;background:#0c0e14cc;border:1px solid #2a3042;border-radius:9px;padding:9px 12px;font-size:11px;
line-height:1.7;max-width:340px}.pl-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;
vertical-align:-1px}.pl-hint{position:absolute;right:14px;top:12px;color:#5a6275;font-size:11px;text-align:right;
line-height:1.6;z-index:5}.pl-warn{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:#2a1818;
border:1px solid #5a2f2f;color:#e06a6a;border-radius:8px;padding:6px 12px;font-size:11px;z-index:6;max-width:60%}
.pl-text{fill:#e6e9f0;pointer-events:none;user-select:none;font-family:inherit}.pl-nodeg{cursor:pointer}
.pl-edge{fill:none;stroke-width:1.4}.pl-seln{stroke:#7aa2ff;stroke-width:2.5;fill:none}.pl-faded{opacity:.13;
transition:opacity .2s}.pl-full{opacity:1;transition:opacity .2s}.pl-rail{grid-row:3;grid-column:2;
border-left:1px solid #2a3042;background:#161922;display:flex;flex-direction:column;min-height:0}
.pl-info{padding:14px 16px;border-bottom:1px solid #2a3042;overflow:auto;flex:0 0 auto;max-height:56%}
.pl-ihd{display:flex;align-items:center;gap:9px;margin-bottom:8px;flex-wrap:wrap}.pl-tag{font-size:10px;
padding:2px 8px;border-radius:5px;font-weight:700;letter-spacing:.5px}.pl-tag.add{background:#163a2a;color:#5bd6a0}
.pl-tag.modify{background:#3a3217;color:#e0a44a}.pl-tag.remove{background:#3a1717;color:#e06a6a}
.pl-tag.existing{background:#222a3d;color:#566089}.pl-tag.kind{background:#23283a;color:#8b93a7}
.pl-ititle{font-weight:700;font-size:15px}.pl-field{margin:8px 0}.pl-flabel{color:#5a6275;font-size:10px;
text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}.pl-ftext{color:#e6e9f0;line-height:1.5}
.pl-quote{border-left:2px solid #e0a44a;padding:3px 9px;color:#e0a44a;background:#231f1066;font-size:12px;
margin-top:3px}.pl-risk{font-size:10px;padding:2px 8px;border-radius:20px;border:1px solid}.pl-risk.low{color:#5bd6a0;
border-color:#2f5547}.pl-risk.med{color:#e0a44a;border-color:#5a4a2a}.pl-risk.high{color:#e06a6a;border-color:#5a2f2f}
.pl-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}.pl-chip{font-size:11px;padding:2px 7px;border-radius:5px;
background:#222a3d;color:#aeb6c9;cursor:pointer}.pl-chip:hover{background:#2d3650}.pl-chip.risk{background:#2a1f12;
color:#e0a44a;cursor:default}.pl-verdict{display:flex;gap:8px;margin-top:12px}.pl-vbtn{flex:1;padding:9px;
border-radius:8px;border:1px solid #2a3042;background:#1c2030;color:#8b93a7;cursor:pointer;font:inherit;
font-weight:600}.pl-vbtn.acc.on,.pl-vbtn.acc:hover{border-color:#5bd6a0;color:#5bd6a0;background:#10231a}
.pl-vbtn.rej.on,.pl-vbtn.rej:hover{border-color:#e06a6a;color:#e06a6a;background:#231010}pre.pl-sig{background:#0c0e14;
border:1px solid #2a3042;border-radius:8px;padding:9px 11px;color:#c9d2e6;font-size:12px;line-height:1.5;overflow:auto;
margin:6px 0 0;white-space:pre-wrap}pre.pl-body{background:#0c0e14;border:1px solid #2a3042;border-radius:8px;
padding:9px 11px;color:#aeb6c9;font-size:11px;line-height:1.45;overflow:auto;max-height:230px;margin:6px 0 0;
white-space:pre}.pl-baf{margin-top:4px;display:flex;flex-direction:column;gap:3px}.pl-baf .row{display:flex;gap:7px;
align-items:baseline}.pl-baf .lab{color:#5a6275;font-size:10px;width:40px;flex:0 0 auto;text-transform:uppercase;
letter-spacing:.5px}.pl-baf code{font-family:inherit;font-size:11.5px;white-space:pre-wrap;line-height:1.45}
.pl-baf .before code{color:#e0857f}.pl-baf .after code{color:#5bd6a0}.pl-empty{color:#5a6275;padding:24px 16px;
text-align:center;line-height:1.7}.pl-difhd{padding:8px 16px;border-bottom:1px solid #2a3042;color:#5a6275;
font-size:11px}.pl-dif{flex:1;overflow:auto;padding:6px 0;font-size:12px;line-height:1.5;min-height:0}
.pl-ln{padding:2px 16px;white-space:pre-wrap;color:#aeb6c9;cursor:pointer;border-left:2px solid transparent}
.pl-ln.add{background:#10231a;color:#5bd6a0;border-left-color:#5bd6a0}.pl-ln.modify{background:#231f10;color:#e0a44a;
border-left-color:#e0a44a}.pl-ln.remove{background:#231010;color:#e06a6a;border-left-color:#e06a6a}
.pl-ln.sel{outline:1px solid #7aa2ff;outline-offset:-1px}.pl-ln .pv{display:inline-block;width:13px;color:#5a6275}
.pl-ln .vd{float:right;font-weight:700}.pl-ln .vd.a{color:#5bd6a0}.pl-ln .vd.r{color:#e06a6a}.pl-ln .incoh{float:right;
color:#e06a6a;margin-right:6px}.pl-verify{grid-column:1/3;display:flex;align-items:center;gap:13px;padding:9px 16px;
background:#11141c;border-top:1px solid #2a3042;font-size:12px}.pl-step{display:flex;align-items:center;gap:7px;
color:#8b93a7}.pl-step .dot{width:9px;height:9px;border-radius:50%;background:#5a6275}
.pl-step.done .dot{background:#5bd6a0}.pl-step.active .dot{background:#7aa2ff;box-shadow:0 0 0 3px #7aa2ff33}
.pl-arrow{color:#5a6275}.pl-vmsg{margin-left:auto;color:#5a6275}
`;

/* =================== small HTML field helpers (shared) =================== */

function fieldHtml(label: string, escapedText: string): string {
  return `<div class="pl-field"><div class="pl-flabel">${label}</div>`
    + `<div class="pl-ftext">${escapedText}</div></div>`;
}

function optFieldHtml(env: PEnv, label: string, val: string | undefined): string {
  return val ? fieldHtml(label, env.esc(val)) : '';
}

function sourceBlockHtml(env: PEnv, label: string, body: string | null): string {
  if (!body) return '';
  return `<div class="pl-field"><div class="pl-flabel">${label}</div><pre class="pl-body">`
    + `${env.esc(body)}</pre></div>`;
}

/* =================== select + info =================== */

function selectRef(env: PEnv, ref: string | null): void {
  env.sel = ref;
  env.render();
  renderInfo(env);
  renderDif(env);
}

/** Real source body for a node id, from the loaded bodies.json (null when absent). */
function bodyOf(env: PEnv, id: string): string | null {
  return env.ctx.bodies?.get(id)?.body ?? null;
}

/** One-line public signature name part: `Name.iface`. */
function sigName(meta: Frontmatter, fallbackName: string): string {
  const iface = meta.interfaces?.[0];
  return (meta.name || fallbackName) + (iface?.name ? '.' + iface.name : '');
}

/** One-line public signature accepts part. */
function sigAccepts(meta: Frontmatter): string {
  return meta.interfaces?.[0]?.accepts?.join(', ') || '';
}

/** One-line public signature returns part. */
function sigReturns(meta: Frontmatter): string {
  const ret = meta.interfaces?.[0]?.returns;
  return ret?.length ? ' → ' + ret.join(' | ') : '';
}

/** One-line public signature from a frontmatter (first interface). */
function sigLine(meta: Frontmatter | undefined, fallbackName: string): string {
  if (!meta) return fallbackName;
  return `${sigName(meta, fallbackName)}(${sigAccepts(meta)})${sigReturns(meta)}`;
}

/** sigLine plus an optional trailing "state:" line. */
function sigLineWithState(meta: Frontmatter, fallbackName: string): string {
  const base = sigLine(meta, fallbackName);
  return meta.state?.length ? base + '\nstate: ' + meta.state.join('; ') : base;
}

function sigBlockHtml(env: PEnv, meta: Frontmatter | undefined, fallbackName: string): string {
  if (!meta) return '';
  return `<pre class="pl-sig">${env.esc(sigLineWithState(meta, fallbackName))}</pre>`;
}

function drillInHtml(childCount: number): string {
  return `<div class="pl-field" style="margin-top:10px"><div class="pl-flabel">drill-in</div>`
    + `<div class="pl-ftext">${childCount} units — double-click to open</div></div>`;
}

function existingNodeHtml(env: PEnv, node: DiagramNode): string {
  const meta = node.fm;
  const sig = sigBlockHtml(env, meta, node.id);
  const source = sourceBlockHtml(env, 'source', bodyOf(env, node.id));
  const childCount = childIdsOf(env.ctx.state, node.id)
    .filter((cid) => env.ctx.state.nodes[cid].shape !== 'group').length;
  const desc = meta?.description ? fieldHtml('desc', env.esc(meta.description)) : '';
  const drillIn = childCount ? drillInHtml(childCount) : '';
  const inPlan = env.byRef[node.id] ? 'in plan' : 'not touched by this plan';
  return `<div class="pl-ihd"><span class="pl-tag existing">EXISTING</span>`
    + `<span class="pl-tag kind">${env.esc(node.kind ?? '')}</span>`
    + `<span class="pl-ititle">${env.esc(node.label)}</span></div>
    ${desc}
    ${sig}
    ${source}
    ${drillIn}
    <div class="pl-meta" style="margin-top:10px">real node · ${inPlan}</div>`;
}

function renderExistingNodeInfo(env: PEnv, box: HTMLElement, ref: string): void {
  const existingNode = env.node(ref);
  if (!existingNode) {
    box.innerHTML = `<div class="pl-empty">${env.esc(ref)}</div>`;
    return;
  }
  box.innerHTML = existingNodeHtml(env, existingNode);
}

function emptyInfoHtml(total: number, nMod: number, nAdd: number): string {
  return `<div class="pl-empty"><b style="color:#8b93a7">Build plan over the real map.</b><br>`
    + `${total} changes · ${nMod} modify existing · ${nAdd} new.<br><br>`
    + `Click a node or a diff line → intent + accept/reject.<br><br>`
    + `<span style="color:#e0a44a">amber</span>=modify · <span style="color:#5bd6a0">green</span>=new · `
    + `<span style="color:#e06a6a">red</span>=remove.</div>`;
}

function renderEmptyInfo(env: PEnv, box: HTMLElement): void {
  const total = env.plan.changes.length;
  const nMod = env.plan.changes.filter((chg) => chg.status === 'modify').length;
  const nAdd = env.plan.changes.filter((chg) => chg.status === 'add').length;
  box.innerHTML = emptyInfoHtml(total, nMod, nAdd);
}

function renderInfo(env: PEnv): void {
  const box = env.$('plInfo');
  if (!env.sel) {
    renderEmptyInfo(env, box);
    return;
  }
  const chg = env.planOn ? env.byRef[env.sel] : undefined;
  if (chg) {
    renderChangeInfo(env, box, chg);
    return;
  }
  renderExistingNodeInfo(env, box, env.sel);
}

/** "real code today" quote — only when the change explicitly quotes the real fm description. */
function quoteBlockHtml(env: PEnv, chg: PlanChange, target: DiagramNode | undefined): string {
  if (!chg.quoteReal || !target?.fm?.description) return '';
  const text = env.esc((target.fm.name || chg.target.ref) + ' — ' + target.fm.description);
  return `<div class="pl-field"><div class="pl-flabel">real code today</div>`
    + `<div class="pl-quote">${text}</div></div>`;
}

/** transitive blast radius for a node change (the real downstream cone). */
function blastRadiusBlockHtml(env: PEnv, chg: PlanChange, isEdge: boolean, real: boolean): string {
  if (isEdge || !real) return '';
  const cone = downstreamCone(env.ctx.state.edges, chg.target.ref, { roots: env.ctx.state.roots });
  if (!cone.affected.length) return '';
  const direct = cone.affected.filter((aff) => aff.depth === 1).length;
  const depthTxt = direct < cone.affected.length ? ` (${direct} direct, depth ≤ ${cone.maxDepth})` : '';
  const entryTxt = cone.entryPoints.length
    ? ` · reaches ${cone.entryPoints.length} entry point${cone.entryPoints.length > 1 ? 's' : ''}`
    : '';
  const chip = (aff: ConeNode): string => `<span class="pl-chip" data-ref="${env.esc(aff.id)}" `
    + `title="${aff.depth} hop${aff.depth > 1 ? 's' : ''} downstream">`
    + `${env.esc(env.node(aff.id)?.label ?? aff.id)}${aff.depth > 1 ? ` ·${aff.depth}` : ''}</span>`;
  const shown = cone.affected.slice(0, 12).map(chip).join('');
  const remaining = cone.affected.length - 12;
  const more = remaining > 0
    ? `<span class="pl-chip" style="cursor:default;background:none;color:#5a6275">+${remaining} more</span>`
    : '';
  return `<div class="pl-field"><div class="pl-flabel">blast radius · ${cone.affected.length} affected`
    + `${depthTxt}${entryTxt}</div><div class="pl-chips">${shown}${more}</div></div>`;
}

// before/after public signature — present when the change proposes a new fm.
// This is the contract the reviewer is actually approving (Phase 1b).
function signatureBlockHtml(env: PEnv, chg: PlanChange, isEdge: boolean, target: DiagramNode | undefined): string {
  if (isEdge || !chg.fm) return '';
  const after = sigLine(chg.fm, chg.target.ref);
  const before = chg.status === 'modify' ? sigLine(target?.fm, chg.target.ref) : null;
  const beforeRow = before
    ? `<div class="row before"><span class="lab">before</span><code>${env.esc(before)}</code></div>`
    : '';
  const afterRow = `<div class="row after"><span class="lab">${before ? 'after' : 'new'}</span>`
    + `<code>${env.esc(after)}</code></div>`;
  return `<div class="pl-field"><div class="pl-flabel">contract · signature</div>`
    + `<div class="pl-baf">${beforeRow}${afterRow}</div></div>`;
}

// real code today — for a modify, surface the actual source body (PLANNER_HANDOVER #3),
// so the reviewer judges the change against real code, not the AI's prose.
function codeTodayBlockHtml(env: PEnv, chg: PlanChange, isEdge: boolean): string {
  if (isEdge || chg.status !== 'modify') return '';
  return sourceBlockHtml(env, 'code today', bodyOf(env, chg.target.ref));
}

/** "depends on" chip list for a change. */
function dependsOnBlockHtml(env: PEnv, chg: PlanChange): string {
  if (!chg.dependsOn?.length) return '';
  const chip = (depId: string): string => {
    const depChg = env.byId[depId];
    const verdict = env.verdicts[depId];
    const mark = verdict === 'reject' ? ' ✕' : verdict === 'accept' ? ' ✓' : '';
    const label = env.esc(depChg?.target.ref ?? depId);
    return `<span class="pl-chip" data-change="${env.esc(depId)}">${label}${mark}</span>`;
  };
  const chips = chg.dependsOn.map(chip).join('');
  return `<div class="pl-field"><div class="pl-flabel">depends on</div><div class="pl-chips">${chips}</div></div>`;
}

/** wire the accept/reject buttons + blast-radius/depends-on chips rendered above. */
function wireChangeInfoHandlers(env: PEnv, box: HTMLElement, chg: PlanChange): void {
  box.querySelectorAll<HTMLElement>('.pl-vbtn').forEach((btn) => {
    btn.onclick = () => setVerdict(env, chg.id, btn.dataset.v as Verdict);
  });
  box.querySelectorAll<HTMLElement>('.pl-chip[data-ref]').forEach((chip) => {
    chip.onclick = () => focusRef(env, chip.dataset.ref!);
  });
  box.querySelectorAll<HTMLElement>('.pl-chip[data-change]').forEach((chip) => {
    chip.onclick = () => {
      const dep = env.byId[chip.dataset.change!];
      if (dep) focusRef(env, dep.target.ref);
    };
  });
}

function changeHeaderHtml(
  env: PEnv, chg: PlanChange, isEdge: boolean, target: DiagramNode | undefined,
): string {
  const title = isEdge
    ? (chg.newEdge ? `${chg.newEdge.from} → ${chg.newEdge.to}` : chg.target.ref)
    : (target?.label ?? chg.target.ref);
  const riskTag = chg.risk
    ? `<span style="margin-left:auto"><span class="pl-risk ${chg.risk}">${chg.risk} risk</span></span>`
    : '';
  return `<div class="pl-ihd"><span class="pl-tag ${chg.status}">${chg.status.toUpperCase()}</span>`
    + `<span class="pl-ititle">${env.esc(title)}</span>${riskTag}</div>`;
}

function changeMetaHtml(chg: PlanChange, isEdge: boolean): string {
  const phaseTxt = chg.phase ? 'P' + chg.phase + ' · ' : '';
  const kindTxt = isEdge
    ? 'edge change'
    : (chg.status === 'modify' ? 'modifies real ' + chg.target.ref : 'new ' + (chg.newNode?.kind ?? 'module'));
  return `<div class="pl-meta" style="margin:-2px 0 8px">${phaseTxt}${kindTxt}</div>`;
}

function verdictButtonsHtml(env: PEnv, chg: PlanChange): string {
  const accOn = env.verdicts[chg.id] === 'accept' ? 'on' : '';
  const rejOn = env.verdicts[chg.id] === 'reject' ? 'on' : '';
  return `<div class="pl-verdict">
    <button class="pl-vbtn acc ${accOn}" data-v="accept">✓ accept</button>
    <button class="pl-vbtn rej ${rejOn}" data-v="reject">✕ reject</button></div>`;
}

function renderChangeInfo(env: PEnv, box: HTMLElement, chg: PlanChange): void {
  const isEdge = chg.target.kind === 'edge';
  const target = env.node(chg.target.ref);
  const real = !isEdge && !!env.ctx.state.nodes[chg.target.ref];
  box.innerHTML = changeHeaderHtml(env, chg, isEdge, target)
    + changeMetaHtml(chg, isEdge)
    + fieldHtml('problem', env.esc(chg.intent.problem))
    + quoteBlockHtml(env, chg, target)
    + fieldHtml('approach', env.esc(chg.intent.approach))
    + optFieldHtml(env, 'rationale', chg.intent.rationale)
    + optFieldHtml(env, 'alternative considered', chg.intent.alternative)
    + optFieldHtml(env, 'tradeoff', chg.intent.tradeoff)
    + signatureBlockHtml(env, chg, isEdge, target)
    + dependsOnBlockHtml(env, chg)
    + blastRadiusBlockHtml(env, chg, isEdge, real)
    + codeTodayBlockHtml(env, chg, isEdge)
    + verdictButtonsHtml(env, chg);
  wireChangeInfoHandlers(env, box, chg);
}

/** Jump selection to a ref, drilling out to the level it lives on if needed. */
function focusRef(env: PEnv, ref: string): void {
  const targetNode = env.node(ref);
  if (targetNode) {
    const lvl = env.ctx.state.nodes[ref] ? containerOf(env.ctx.state, ref) : (env.synth[ref]?.parent ?? null);
    if (lvl !== env.level) {
      env.level = lvl;
      env.fit();
    }
  }
  selectRef(env, ref);
}

function setVerdict(env: PEnv, changeId: string, verdict: Verdict): void {
  env.verdicts[changeId] = env.verdicts[changeId] === verdict ? undefined : verdict;
  env.render();
  renderInfo(env);
  renderDif(env);
  updateProgress(env);
}

/* =================== diff list =================== */

function phaseHeaderHtml(env: PEnv, phaseId: number): string {
  const phaseDef = env.plan.phases?.find((phase) => phase.id === phaseId);
  const title = phaseDef ? '— ' + phaseDef.title + ' —' : '— phase ' + phaseId + ' —';
  return `<div class="pl-ln" style="cursor:default;color:#5a6275;background:none">${env.esc(title)}</div>`;
}

function diffLineHtml(env: PEnv, chg: PlanChange, warns: Set<string>): string {
  const selCls = chg.target.ref === env.sel ? ' sel' : '';
  const incoh = warns.has(chg.id) ? '<span class="incoh">⚠</span>' : '';
  const prefix = chg.status === 'add' ? '+' : chg.status === 'remove' ? '−' : '~';
  const verdict = env.verdicts[chg.id];
  const verdictMark = verdict === 'accept' ? '<span class="vd a">✓</span>'
    : verdict === 'reject' ? '<span class="vd r">✕</span>' : '';
  const what = chg.target.kind === 'edge'
    ? (chg.newEdge ? `${chg.newEdge.from}→${chg.newEdge.to}` : chg.target.ref)
    : chg.target.ref;
  return `<div class="pl-ln ${chg.status}${selCls}" data-ref="${env.esc(chg.target.ref)}">`
    + `<span class="pv">${prefix}</span>${env.esc(what)} `
    + `<span style="color:#5a6275">· ${env.esc(chg.intent.approach.slice(0, 48))}…</span>`
    + `${incoh}${verdictMark}</div>`;
}

function wireDifHandlers(env: PEnv, box: HTMLElement): void {
  box.querySelectorAll<HTMLElement>('.pl-ln[data-ref]').forEach((lineEl) => {
    lineEl.onclick = () => focusRef(env, lineEl.dataset.ref!);
  });
  const selEl = box.querySelector('.pl-ln.sel');
  if (selEl) selEl.scrollIntoView({ block: 'nearest' });
}

function renderDif(env: PEnv): void {
  const box = env.$('plDif');
  const warns = new Set(coherenceWarnings(env.plan, env.verdicts).map((warn) => warn.changeId));
  const lines: string[] = [];
  let curPhase = -1;
  for (const chg of [...env.plan.changes].sort((changeA, changeB) => (changeA.phase ?? 9) - (changeB.phase ?? 9))) {
    const phaseId = chg.phase ?? 9;
    if (phaseId !== curPhase) {
      curPhase = phaseId;
      lines.push(phaseHeaderHtml(env, curPhase));
    }
    lines.push(diffLineHtml(env, chg, warns));
  }
  box.innerHTML = lines.join('');
  wireDifHandlers(env, box);
}

/* =================== phases =================== */

function phaseRowHtml(env: PEnv, phase: PlanPhase): string {
  const cnt = env.plan.changes.filter((chg) => chg.phase === phase.id).length;
  const onCls = env.phaseFocus === phase.id ? 'on' : '';
  return `<div class="pl-phase ${onCls}" data-p="${phase.id}"><span class="n">${env.esc(phase.subtitle ?? '')}</span>`
    + `<span class="t">${env.esc(phase.title)}</span><span class="c">${cnt} changes</span></div>`;
}

function renderPhases(env: PEnv): void {
  const phases = env.plan.phases ?? [];
  env.$('plPhases').innerHTML = phases.map((phase) => phaseRowHtml(env, phase)).join('');
  env.$('plPhases').querySelectorAll<HTMLElement>('.pl-phase').forEach((phaseEl) => {
    phaseEl.onclick = () => {
      const id = +phaseEl.dataset.p!;
      env.phaseFocus = env.phaseFocus === id ? null : id;
      renderPhases(env);
      env.render();
    };
  });
}

function renderLegend(env: PEnv): void {
  const row1 = '<div style="color:#8b93a7;margin-bottom:3px">plan overlay — metadata on real nodes/edges</div>';
  const row2 = '<div><span class="pl-sw" style="background:#566089"></span>existing (untouched)</div>';
  const row3 = '<div><span class="pl-sw" style="background:#e0a44a"></span>modify &nbsp;'
    + '<span class="pl-sw" style="background:#5bd6a0"></span>new &nbsp;'
    + '<span class="pl-sw" style="background:#e06a6a"></span>remove</div>';
  const row4 = '<div style="color:#5a6275;margin-top:3px">dashed amber = change depends-on'
    + ' · double-click → drill</div>';
  env.$('plLegend').innerHTML = row1 + row2 + row3 + row4;
}

/* =================== progress / export =================== */

function updateProgress(env: PEnv): void {
  const total = env.plan.changes.length;
  const done = env.plan.changes.filter((chg) => env.verdicts[chg.id]).length;
  const acc = env.plan.changes.filter((chg) => env.verdicts[chg.id] === 'accept').length;
  const warnCount = coherenceWarnings(env.plan, env.verdicts).length;
  env.$('plProg').textContent = `${done}/${total} reviewed`;
  (env.$('plFill') as HTMLElement).style.width = (total ? done / total * 100 : 0) + '%';
  const ready = done === total && warnCount === 0;
  (env.$('plExport') as HTMLButtonElement).disabled = !ready;
  env.$('plS2').className = 'pl-step ' + (done === total ? 'done' : 'active');
  env.$('plS3').className = 'pl-step ' + (ready ? 'active' : '');
  env.$('plVmsg').textContent = warnCount
    ? `resolve ${warnCount} incoherent verdict${warnCount > 1 ? 's' : ''} to export`
    : done === total ? `${acc} accepted · ready to export to buildspec`
      : `review ${total - done} more to unlock export`;
}

/** Serialize a model to a pipeline-parseable spec .mmd (fm:meta + kind + parent + nodes + edges). */
function serializeSpec(model: { nodes: Record<string, DiagramNode>; edges: DiagramEdge[] }): string {
  const ids = Object.keys(model.nodes).sort();
  const nodes = model.nodes;
  const arrow: Record<string, string> = { solid: '-->', thick: '==>', dotted: '-.->' };
  const meta = ids.map((id) => (nodes[id].fm ? frontmatterToMermaid(id, nodes[id].fm as Frontmatter) : '')).join('');
  const kind = ids.map((id) => (nodes[id].kind ? `%% kind ${id} ${nodes[id].kind}\n` : '')).join('');
  const parent = ids.map((id) => {
    const par = nodes[id].parent;
    return par && nodes[par] && nodes[par].shape !== 'group' ? `%% parent ${id} ${par}\n` : '';
  }).join('');
  const nodeDecls = ids.map((id) => {
    const node = nodes[id];
    return node.shape !== 'group' ? `  ${id}["${node.label.replace(/"/g, '')}"]\n` : '';
  }).join('');
  const edges = model.edges.map((edge) => `  ${edge.from} ${arrow[edge.style] || '-->'} ${edge.to}\n`).join('');
  return 'flowchart TD\n' + meta + kind + parent + nodeDecls + edges;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isAccepted(env: PEnv, id: string): boolean {
  return env.verdicts[id] === 'accept';
}

// (1) the DECISION ARTIFACT (H2) — the human's per-change verdicts captured as
// DATA, not discarded. approve-export.mjs --accepted-only consumes this to mint the
// SAME enforceable bundle (approved.mmd + contracts + CHECKLIST + plan.json), so the
// human review is itself a verifiable artifact and editor-approval drives the CLI bundle.
function downloadDecisionArtifact(env: PEnv): void {
  const decisionVerdicts: Record<string, Verdict> = {};
  for (const [id, verdict] of Object.entries(env.verdicts)) {
    if (verdict) decisionVerdicts[id] = verdict;
  }
  const decision: Plan = { ...env.plan, verdicts: decisionVerdicts };
  downloadText('approved-plan.json', JSON.stringify(decision, null, 2));
}

// (2) the approved spec preview = base map + accepted adds / removes / fm-mutations
// (visual reference; the CLI re-derives the canonical map via toMmd from the artifact above).
function downloadSpecPreview(env: PEnv): void {
  const model = applyPlan(env.ctx.state, env.plan, (id) => isAccepted(env, id));
  downloadText('approved-spec.mmd', serializeSpec(model));
}

/** the two export-summary strings (side-panel HTML + toast text) share every input tally. */
function exportSummary(accepted: PlanChange[]): { vmsg: string; toast: string } {
  const newNodes = accepted.filter((chg) => chg.status === 'add' && chg.target.kind === 'node').length;
  const newEdges = accepted.filter((chg) => chg.status === 'add' && chg.target.kind === 'edge').length;
  const mods = accepted.filter((chg) => chg.status === 'modify').length;
  const removes = accepted.filter((chg) => chg.status === 'remove').length;
  const withSig = accepted.filter((chg) => chg.fm).length;
  const vmsg = `<b style="color:#5bd6a0">approved-plan.json</b> downloaded (${accepted.length} accepted) · `
    + `${newNodes} new + ${mods} modified → run `
    + `<code>novakai:approve -- --plan approved-plan.json --accepted-only --out build/approval</code>`;
  const toast = `Decision artifact: ${accepted.length} accepted (${newNodes} new node(s), ${newEdges} edge(s), `
    + `${mods} modify, ${removes} remove · ${withSig} carry a signature contract) → approve-export --accepted-only`;
  return { vmsg, toast };
}

// the build checklist — exactly what the gate flags as "unbuilt" until coded.
function finishExportUi(env: PEnv, accepted: PlanChange[]): void {
  env.$('plS3').className = 'pl-step done';
  env.$('plS4').className = 'pl-step active';
  const { vmsg, toast } = exportSummary(accepted);
  env.$('plVmsg').innerHTML = vmsg;
  env.ctx.hooks.toast(toast);
}

function doExport(env: PEnv): void {
  const total = env.plan.changes.length;
  const done = env.plan.changes.filter((chg) => env.verdicts[chg.id]).length;
  if (done < total || coherenceWarnings(env.plan, env.verdicts).length) {
    env.ctx.hooks.toast('Resolve all changes + coherence first');
    return;
  }
  const accepted = env.plan.changes.filter((chg) => isAccepted(env, chg.id));
  downloadDecisionArtifact(env);
  downloadSpecPreview(env);
  finishExportUi(env, accepted);
}

function togglePlan(env: PEnv): void {
  env.planOn = !env.planOn;
  env.$('plSwitch').className = 'pl-switch' + (env.planOn ? ' on' : '');
  env.$('plSwitch').textContent = (env.planOn ? '● ' : '○ ') + 'plan overlay';
  env.render();
  renderInfo(env);
}

export function initPlannerInfo(env: PEnv): void {
  env.select = (ref) => selectRef(env, ref);
  env.renderInfo = () => renderInfo(env);
  env.renderDif = () => renderDif(env);
  env.renderPhases = () => renderPhases(env);
  env.renderLegend = () => renderLegend(env);
  env.updateProgress = () => updateProgress(env);
  env.togglePlan = () => togglePlan(env);
  env.doExport = () => doExport(env);
}
