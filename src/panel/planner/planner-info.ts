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
  type Plan, type PlanChange, type Verdict,
} from '../../core/plan/plan';
import type { PEnv } from './planner';

// Overlay stylesheet (shell + canvas + side-panel/diff rules), injected once by planner.ts.
// Lives here because the majority of these rules style the info panel and diff list.
export const PLANNER_CSS = `
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

export function initPlannerInfo(E: PEnv): void {
  /* =================== select + info =================== */
  function select(ref: string | null): void { E.sel = ref; E.render(); renderInfo(); renderDif(); }

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
  function bodyOf(id: string): string | null { return E.ctx.bodies?.get(id)?.body ?? null; }

  function renderInfo(): void {
    const box = E.$('plInfo');
    if (!E.sel) {
      const nMod = E.plan.changes.filter((chg) => chg.status === 'modify').length;
      const nAdd = E.plan.changes.filter((chg) => chg.status === 'add').length;
      box.innerHTML = `<div class="pl-empty"><b style="color:#8b93a7">Build plan over the real map.</b><br>${E.plan.changes.length} changes · ${nMod} modify existing · ${nAdd} new.<br><br>Click a node or a diff line → intent + accept/reject.<br><br><span style="color:#e0a44a">amber</span>=modify · <span style="color:#5bd6a0">green</span>=new · <span style="color:#e06a6a">red</span>=remove.</div>`;
      return;
    }
    const ch = E.planOn ? E.byRef[E.sel] : undefined;
    if (ch) { renderChangeInfo(box, ch); return; }
    // plain existing node
    const nd = E.node(E.sel);
    if (!nd) { box.innerHTML = `<div class="pl-empty">${E.esc(E.sel)}</div>`; return; }
    const fm = nd.fm; const i0 = fm?.interfaces?.[0];
    const sig = fm ? `<pre class="pl-sig">${E.esc((fm.name || nd.id) + (i0?.name ? '.' + i0.name : '') + '(' + (i0?.accepts?.join(', ') || '') + ')' + (i0?.returns?.length ? ' → ' + i0.returns.join(' | ') : '') + (fm.state?.length ? '\nstate: ' + fm.state.join('; ') : ''))}</pre>` : '';
    const nfn = childIdsOf(E.ctx.state, nd.id).filter((cid) => E.ctx.state.nodes[cid].shape !== 'group').length;
    const body = bodyOf(nd.id);
    const codeToday = body ? `<div class="pl-field"><div class="pl-flabel">source</div><pre class="pl-body">${E.esc(body)}</pre></div>` : '';
    box.innerHTML = `<div class="pl-ihd"><span class="pl-tag existing">EXISTING</span><span class="pl-tag kind">${E.esc(nd.kind ?? '')}</span><span class="pl-ititle">${E.esc(nd.label)}</span></div>
      ${fm?.description ? `<div class="pl-field"><div class="pl-flabel">desc</div><div class="pl-ftext">${E.esc(fm.description)}</div></div>` : ''}
      ${sig}
      ${codeToday}
      ${nfn ? `<div class="pl-field" style="margin-top:10px"><div class="pl-flabel">drill-in</div><div class="pl-ftext">${nfn} units — double-click to open</div></div>` : ''}
      <div class="pl-meta" style="margin-top:10px">real node · ${E.byRef[nd.id] ? 'in plan' : 'not touched by this plan'}</div>`;
  }

  /** "real code today" quote — only when the change explicitly quotes the real fm description. */
  function quoteBlockHtml(ch: PlanChange, target: DiagramNode | undefined): string {
    if (!ch.quoteReal || !target?.fm?.description) return '';
    return `<div class="pl-field"><div class="pl-flabel">real code today</div><div class="pl-quote">${E.esc((target.fm.name || ch.target.ref) + ' — ' + target.fm.description)}</div></div>`;
  }

  /** transitive blast radius for a node change (the real downstream cone). */
  function blastRadiusBlockHtml(ch: PlanChange, isEdge: boolean, real: boolean): string {
    if (isEdge || !real) return '';
    const cone = downstreamCone(E.ctx.state.edges, ch.target.ref, { roots: E.ctx.state.roots });
    if (!cone.affected.length) return '';
    const direct = cone.affected.filter((aff) => aff.depth === 1).length;
    const chips = cone.affected.slice(0, 12).map((aff) =>
      `<span class="pl-chip" data-ref="${E.esc(aff.id)}" title="${aff.depth} hop${aff.depth > 1 ? 's' : ''} downstream">${E.esc(E.node(aff.id)?.label ?? aff.id)}${aff.depth > 1 ? ` ·${aff.depth}` : ''}</span>`).join('');
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
      + (before ? `<div class="row before"><span class="lab">before</span><code>${E.esc(before)}</code></div>` : '')
      + `<div class="row after"><span class="lab">${before ? 'after' : 'new'}</span><code>${E.esc(after)}</code></div></div></div>`;
  }

  // real code today — for a modify, surface the actual source body (PLANNER_HANDOVER #3),
  // so the reviewer judges the change against real code, not the AI's prose.
  function codeTodayBlockHtml(ch: PlanChange, isEdge: boolean): string {
    if (isEdge || ch.status !== 'modify') return '';
    const body = bodyOf(ch.target.ref);
    return body ? `<div class="pl-field"><div class="pl-flabel">code today</div><pre class="pl-body">${E.esc(body)}</pre></div>` : '';
  }

  /** "depends on" chip list for a change. */
  function dependsOnBlockHtml(ch: PlanChange): string {
    if (!ch.dependsOn?.length) return '';
    const chips = ch.dependsOn.map((depId) => { const dc = E.byId[depId]; const vd = E.verdicts[depId]; const mark = vd === 'reject' ? ' ✕' : vd === 'accept' ? ' ✓' : ''; return `<span class="pl-chip" data-change="${E.esc(depId)}">${E.esc(dc?.target.ref ?? depId)}${mark}</span>`; }).join('');
    return `<div class="pl-field"><div class="pl-flabel">depends on</div><div class="pl-chips">${chips}</div></div>`;
  }

  /** wire the accept/reject buttons + blast-radius/depends-on chips rendered above. */
  function wireChangeInfoHandlers(box: HTMLElement, ch: PlanChange): void {
    box.querySelectorAll<HTMLElement>('.pl-vbtn').forEach((btn) => { btn.onclick = () => setVerdict(ch.id, btn.dataset.v as Verdict); });
    box.querySelectorAll<HTMLElement>('.pl-chip[data-ref]').forEach((chip) => { chip.onclick = () => focusRef(chip.dataset.ref!); });
    box.querySelectorAll<HTMLElement>('.pl-chip[data-change]').forEach((chip) => { chip.onclick = () => { const dep = E.byId[chip.dataset.change!]; if (dep) focusRef(dep.target.ref); }; });
  }

  function renderChangeInfo(box: HTMLElement, ch: PlanChange): void {
    const isEdge = ch.target.kind === 'edge';
    const target = E.node(ch.target.ref);
    const title = isEdge ? (ch.newEdge ? `${ch.newEdge.from} → ${ch.newEdge.to}` : ch.target.ref) : (target?.label ?? ch.target.ref);
    const phaseTxt = ch.phase ? 'P' + ch.phase : '';
    const real = !isEdge && !!E.ctx.state.nodes[ch.target.ref];
    const opt = (label: string, val?: string): string => val ? `<div class="pl-field"><div class="pl-flabel">${label}</div><div class="pl-ftext">${E.esc(val)}</div></div>` : '';

    const quote = quoteBlockHtml(ch, target);
    const blast = blastRadiusBlockHtml(ch, isEdge, real);
    const sigBlock = signatureBlockHtml(ch, isEdge, target);
    const codeBlock = codeTodayBlockHtml(ch, isEdge);
    const deps = dependsOnBlockHtml(ch);

    box.innerHTML = `<div class="pl-ihd"><span class="pl-tag ${ch.status}">${ch.status.toUpperCase()}</span><span class="pl-ititle">${E.esc(title)}</span>
        ${ch.risk ? `<span style="margin-left:auto"><span class="pl-risk ${ch.risk}">${ch.risk} risk</span></span>` : ''}</div>
      <div class="pl-meta" style="margin:-2px 0 8px">${phaseTxt ? phaseTxt + ' · ' : ''}${isEdge ? 'edge change' : (ch.status === 'modify' ? 'modifies real ' + ch.target.ref : 'new ' + (ch.newNode?.kind ?? 'module'))}</div>
      <div class="pl-field"><div class="pl-flabel">problem</div><div class="pl-ftext">${E.esc(ch.intent.problem)}</div></div>
      ${quote}
      <div class="pl-field"><div class="pl-flabel">approach</div><div class="pl-ftext">${E.esc(ch.intent.approach)}</div></div>
      ${opt('rationale', ch.intent.rationale)}
      ${opt('alternative considered', ch.intent.alternative)}
      ${opt('tradeoff', ch.intent.tradeoff)}
      ${sigBlock}
      ${deps}
      ${blast}
      ${codeBlock}
      <div class="pl-verdict">
        <button class="pl-vbtn acc ${E.verdicts[ch.id] === 'accept' ? 'on' : ''}" data-v="accept">✓ accept</button>
        <button class="pl-vbtn rej ${E.verdicts[ch.id] === 'reject' ? 'on' : ''}" data-v="reject">✕ reject</button></div>`;

    wireChangeInfoHandlers(box, ch);
  }

  /** Jump selection to a ref, drilling out to the level it lives on if needed. */
  function focusRef(ref: string): void {
    const nd = E.node(ref);
    if (nd) {
      const lvl = E.ctx.state.nodes[ref] ? containerOf(E.ctx.state, ref) : (E.synth[ref]?.parent ?? null);
      if (lvl !== E.level) { E.level = lvl; E.fit(); }
    }
    select(ref);
  }

  function setVerdict(changeId: string, vd: Verdict): void {
    E.verdicts[changeId] = E.verdicts[changeId] === vd ? undefined : vd;
    E.render(); renderInfo(); renderDif(); updateProgress();
  }

  /* =================== diff list =================== */
  function renderDif(): void {
    const box = E.$('plDif');
    const warns = new Set(coherenceWarnings(E.plan, E.verdicts).map((warn) => warn.changeId));
    const lines: string[] = [];
    const order = [...E.plan.changes].sort((ca, cb) => (ca.phase ?? 9) - (cb.phase ?? 9));
    let curPhase = -1;
    order.forEach((chg) => {
      if ((chg.phase ?? 9) !== curPhase) {
        curPhase = chg.phase ?? 9;
        const phase = E.plan.phases?.find((ph) => ph.id === curPhase);
        lines.push(`<div class="pl-ln" style="cursor:default;color:#5a6275;background:none">${E.esc(phase ? '— ' + phase.title + ' —' : '— phase ' + curPhase + ' —')}</div>`);
      }
      const pfx = chg.status === 'add' ? '+' : chg.status === 'remove' ? '−' : '~';
      const selCls = chg.target.ref === E.sel ? ' sel' : '';
      const verdict = E.verdicts[chg.id]; const vdMark = verdict === 'accept' ? '<span class="vd a">✓</span>' : verdict === 'reject' ? '<span class="vd r">✕</span>' : '';
      const incoh = warns.has(chg.id) ? '<span class="incoh">⚠</span>' : '';
      const what = chg.target.kind === 'edge' ? (chg.newEdge ? `${chg.newEdge.from}→${chg.newEdge.to}` : chg.target.ref) : chg.target.ref;
      lines.push(`<div class="pl-ln ${chg.status}${selCls}" data-ref="${E.esc(chg.target.ref)}"><span class="pv">${pfx}</span>${E.esc(what)} <span style="color:#5a6275">· ${E.esc(chg.intent.approach.slice(0, 48))}…</span>${incoh}${vdMark}</div>`);
    });
    box.innerHTML = lines.join('');
    box.querySelectorAll<HTMLElement>('.pl-ln[data-ref]').forEach((ln) => { ln.onclick = () => focusRef(ln.dataset.ref!); });
    const selEl = box.querySelector('.pl-ln.sel'); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  /* =================== phases =================== */
  function renderPhases(): void {
    const ph = E.plan.phases ?? [];
    E.$('plPhases').innerHTML = ph.map((phase) => {
      const cnt = E.plan.changes.filter((chg) => chg.phase === phase.id).length;
      return `<div class="pl-phase ${E.phaseFocus === phase.id ? 'on' : ''}" data-p="${phase.id}"><span class="n">${E.esc(phase.subtitle ?? '')}</span><span class="t">${E.esc(phase.title)}</span><span class="c">${cnt} changes</span></div>`;
    }).join('');
    E.$('plPhases').querySelectorAll<HTMLElement>('.pl-phase').forEach((pd) => { pd.onclick = () => { const id = +pd.dataset.p!; E.phaseFocus = E.phaseFocus === id ? null : id; renderPhases(); E.render(); }; });
  }

  function renderLegend(): void {
    E.$('plLegend').innerHTML = `<div style="color:#8b93a7;margin-bottom:3px">plan overlay — metadata on real nodes/edges</div>
      <div><span class="pl-sw" style="background:#566089"></span>existing (untouched)</div>
      <div><span class="pl-sw" style="background:#e0a44a"></span>modify &nbsp;<span class="pl-sw" style="background:#5bd6a0"></span>new &nbsp;<span class="pl-sw" style="background:#e06a6a"></span>remove</div>
      <div style="color:#5a6275;margin-top:3px">dashed amber = change depends-on · double-click → drill</div>`;
  }

  /* =================== progress / export =================== */
  function updateProgress(): void {
    const total = E.plan.changes.length;
    const done = E.plan.changes.filter((chg) => E.verdicts[chg.id]).length;
    const acc = E.plan.changes.filter((chg) => E.verdicts[chg.id] === 'accept').length;
    const cw = coherenceWarnings(E.plan, E.verdicts).length;
    E.$('plProg').textContent = `${done}/${total} reviewed`;
    (E.$('plFill') as HTMLElement).style.width = (total ? done / total * 100 : 0) + '%';
    const ready = done === total && cw === 0;
    (E.$('plExport') as HTMLButtonElement).disabled = !ready;
    E.$('plS2').className = 'pl-step ' + (done === total ? 'done' : 'active');
    E.$('plS3').className = 'pl-step ' + (ready ? 'active' : '');
    E.$('plVmsg').textContent = cw ? `resolve ${cw} incoherent verdict${cw > 1 ? 's' : ''} to export`
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
    const total = E.plan.changes.length, done = E.plan.changes.filter((chg) => E.verdicts[chg.id]).length;
    if (done < total || coherenceWarnings(E.plan, E.verdicts).length) { E.ctx.hooks.toast('Resolve all changes + coherence first'); return; }
    const isAcc = (id: string): boolean => E.verdicts[id] === 'accept';
    const accepted = E.plan.changes.filter((chg) => isAcc(chg.id));

    // (1) the DECISION ARTIFACT (H2) — the human's per-change verdicts captured as
    // DATA, not discarded. approve-export.mjs --accepted-only consumes this to mint the
    // SAME enforceable bundle (approved.mmd + contracts + CHECKLIST + plan.json), so the
    // human review is itself a verifiable artifact and editor-approval drives the CLI bundle.
    const decisionVerdicts: Record<string, Verdict> = {};
    for (const [id, vd] of Object.entries(E.verdicts)) if (vd) decisionVerdicts[id] = vd;
    const decision: Plan = { ...E.plan, verdicts: decisionVerdicts };
    downloadText('approved-plan.json', JSON.stringify(decision, null, 2));

    // (2) the approved spec preview = base map + accepted adds / removes / fm-mutations
    // (visual reference; the CLI re-derives the canonical map via toMmd from the artifact above).
    const model = applyPlan(E.ctx.state, E.plan, isAcc);
    downloadText('approved-spec.mmd', serializeSpec(model));

    // the build checklist — exactly what the gate flags as "unbuilt" until coded.
    const newNodes = accepted.filter((chg) => chg.status === 'add' && chg.target.kind === 'node').length;
    const newEdges = accepted.filter((chg) => chg.status === 'add' && chg.target.kind === 'edge').length;
    const mods = accepted.filter((chg) => chg.status === 'modify').length;
    const removes = accepted.filter((chg) => chg.status === 'remove').length;
    const withSig = accepted.filter((chg) => chg.fm).length;

    E.$('plS3').className = 'pl-step done'; E.$('plS4').className = 'pl-step active';
    E.$('plVmsg').innerHTML = `<b style="color:#5bd6a0">approved-plan.json</b> downloaded (${accepted.length} accepted) · ${newNodes} new + ${mods} modified → run <code>novakai:approve -- --plan approved-plan.json --accepted-only --out build/approval</code>`;
    E.ctx.hooks.toast(`Decision artifact: ${accepted.length} accepted (${newNodes} new node(s), ${newEdges} edge(s), ${mods} modify, ${removes} remove · ${withSig} carry a signature contract) → approve-export --accepted-only`);
  }

  function togglePlan(): void {
    E.planOn = !E.planOn;
    E.$('plSwitch').className = 'pl-switch' + (E.planOn ? ' on' : '');
    E.$('plSwitch').textContent = (E.planOn ? '● ' : '○ ') + 'plan overlay';
    E.render(); renderInfo();
  }

  E.select = select;
  E.renderInfo = renderInfo;
  E.renderDif = renderDif;
  E.renderPhases = renderPhases;
  E.renderLegend = renderLegend;
  E.updateProgress = updateProgress;
  E.togglePlan = togglePlan;
  E.doExport = doExport;
}
