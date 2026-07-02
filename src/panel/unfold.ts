/* =====================================================================
   unfold.ts — reading mode: the folded map you open only where you look
   ---------------------------------------------------------------------
   Responsibility: render ctx.state as ONE folded organism (full-screen
   overlay). Arrival shows only the containment roots; everything else is
   revealed by the reader — unfold in place, plus opt-in layers (call and
   dependency wires, descriptions, interfaces, metrics, colour, blast
   radius), a checkable browse tree, and an inspector that is empty until
   something is selected (source bodies come from ctx.bodies when loaded).
   The surface itself carries no titles and no narration by design: the
   summary forms in the reader's head, not on the screen.

   Isolation (the planner.ts pattern): builds its OWN overlay DOM and
   injects its OWN CSS. The only edits outside this file are one toolbar
   button in index.html and the deps wiring in main.ts. Reads ctx.state +
   ctx.bodies; the ONLY writes are through the shared model path
   (renameInPlace / mountFrontmatter → ctx.hooks sync + history + persist)
   — never a private write path. Selection and the per-diagram reading
   session survive the mode boundary (selectSync / persistView).

   Containment: a node's live `parent` wins; otherwise the flowmap drill
   convention applies — an id `mod__rest` folds under node `mod` when that
   node exists. Generic diagrams fold by their real containment only.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { DiagramNode, Point } from '../core/types/types';
import type { SelectionApi } from '../interaction/selection';
import type { CameraApi } from '../core/camera/camera';
import { esc } from '../core/config/config';
import { portPos, bestSides } from '../core/state/state';
import { orthoPath as elbowPath, polyPath } from '../render/wires';
import { routeGraph } from '../render/avoidRouter';
import type { AdhocRect, AdhocEdge } from '../render/avoidRouter';
import { initInspectorFrontmatter } from './inspector-frontmatter';

export interface UnfoldApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/* ---- folded-view unit (derived from ctx.state on every open) ---- */
interface UNode {
  id: string;
  label: string;
  kind: string;            // semantic kind, or 'group' for containers without one
  desc: string;
  accepts: string[];
  returns: string[];
  state: string[];
  children: string[];
  parent: string | null;
  fanIn: number;
}
interface UEdge { from: string; to: string; label: string; call: boolean; dep: boolean; w: number }
interface Box { x: number; y: number; w: number; h: number; cx: number; cy: number }

const NS = 'http://www.w3.org/2000/svg';
const SYM_KINDS = new Set(['type', 'function', 'class', 'store', 'hook', 'service', 'event', 'component']);

const CSS = `
.uf-overlay{position:fixed;inset:0;z-index:70;display:none;
  --uf-bg:#f3f1ec;--uf-stage:#f6f4ef;--uf-surface:#ffffff;--uf-surface2:#faf8f3;
  --uf-line:#e6e2d9;--uf-line-soft:#efece4;--uf-hair:#f1eee7;
  --uf-ink:#33322e;--uf-ink2:#605c54;--uf-dim:#948f84;--uf-faint:#bbb4a7;
  --uf-accent:#4a6b8a;--uf-accent-soft:rgba(74,107,138,.10);--uf-accent-line:rgba(74,107,138,.32);
  --uf-k-type:#7c6aa8;--uf-k-function:#4a6b8a;--uf-k-module:#4a8a72;--uf-k-store:#a8824a;--uf-k-class:#a85a6a;
  --uf-shadow:0 1px 2px rgba(40,36,30,.04),0 6px 20px rgba(40,36,30,.05);
  --uf-shadow-lift:0 2px 6px rgba(40,36,30,.07),0 14px 40px rgba(40,36,30,.09);
  --uf-ease:cubic-bezier(.22,.61,.36,1);
  background:var(--uf-bg);color:var(--uf-ink);
  font:14px/1.55 Inter,-apple-system,BlinkMacSystemFont,ui-sans-serif,system-ui;
  -webkit-font-smoothing:antialiased}
.uf-overlay.dark{
  --uf-bg:#131315;--uf-stage:#161618;--uf-surface:#1c1c1f;--uf-surface2:#212125;
  --uf-line:#2b2b30;--uf-line-soft:#242428;--uf-hair:#202024;
  --uf-ink:#e7e4dd;--uf-ink2:#b4afa5;--uf-dim:#8b867c;--uf-faint:#5c584f;
  --uf-accent:#82a8cc;--uf-accent-soft:rgba(130,168,204,.12);--uf-accent-line:rgba(130,168,204,.34);
  --uf-k-type:#b09bd8;--uf-k-function:#82a8cc;--uf-k-module:#77c2a2;--uf-k-store:#d0a862;--uf-k-class:#d68a9a;
  --uf-shadow:0 1px 2px rgba(0,0,0,.30),0 8px 26px rgba(0,0,0,.34);
  --uf-shadow-lift:0 2px 8px rgba(0,0,0,.40),0 18px 48px rgba(0,0,0,.46)}
.uf-overlay.show{display:flex}
.uf-overlay *{box-sizing:border-box}
.uf-overlay button{font:inherit;color:inherit;background:none;border:none;cursor:pointer;padding:0}
.uf-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

.uf-stage{position:relative;flex:1;overflow:hidden;cursor:grab;background:var(--uf-stage)}
.uf-stage.grab{cursor:grabbing}
.uf-world{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
.uf-world.anim{transition:transform .42s var(--uf-ease)}
/* wires paint ABOVE the containers: an edge between cards inside unfolded groups must stay
   visible crossing the group surfaces, or the wires layer lies by omission */
.uf-wires{position:absolute;top:0;left:0;overflow:visible;pointer-events:none;z-index:2}
.uf-content{position:relative}
.uf-dock{position:absolute;left:14px;bottom:14px;display:flex;gap:6px;z-index:20}
.uf-dock button{width:34px;height:34px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--uf-line);border-radius:8px;background:var(--uf-surface);color:var(--uf-ink2);
  box-shadow:var(--uf-shadow);transition:color .15s,border-color .15s}
.uf-dock button:hover{color:var(--uf-ink);border-color:var(--uf-faint)}
.uf-dock svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.uf-dock .uf-gap{width:8px}
.uf-hint{position:absolute;left:0;right:0;bottom:16px;text-align:center;z-index:15;pointer-events:none;
  color:var(--uf-faint);font-size:12px}
.uf-hint b{color:var(--uf-dim);font-weight:500}

.uf-grp{border:1px solid var(--uf-line);border-radius:12px;background:var(--uf-surface2);padding:13px;flex:none}
.uf-grp>.uf-ghead{display:flex;align-items:center;gap:9px;padding:2px 4px 11px;cursor:pointer;user-select:none}
.uf-grp>.uf-ghead .uf-tw{width:15px;height:15px;flex:none;display:flex;align-items:center;justify-content:center;
  color:var(--uf-faint);transition:transform .2s var(--uf-ease)}
.uf-grp>.uf-ghead .uf-tw svg{width:9px;height:9px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.uf-grp.open>.uf-ghead .uf-tw{transform:rotate(90deg)}
.uf-grp>.uf-ghead .uf-gname{font-weight:500;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--uf-ink2)}
.uf-grp>.uf-ghead .uf-gcount{color:var(--uf-faint);font-size:11px;margin-left:auto;font-family:ui-monospace,Menlo,monospace}
.uf-gbody{display:flex;gap:14px;align-items:flex-start}
.uf-grp.col>.uf-gbody{flex-direction:column}
.uf-grp.row>.uf-gbody,.uf-grp.leaf>.uf-gbody{flex-direction:row;flex-wrap:wrap;gap:11px}

.uf-card{position:relative;border:1px solid var(--uf-line);border-radius:10px;background:var(--uf-surface);
  padding:11px 13px;cursor:pointer;min-width:140px;max-width:230px;flex:none;box-shadow:var(--uf-shadow);
  transition:border-color .16s,box-shadow .16s,transform .16s,opacity .18s}
.uf-card:hover{border-color:var(--uf-faint);box-shadow:var(--uf-shadow-lift);transform:translateY(-1px)}
.uf-card .uf-crow{display:flex;align-items:center;gap:8px}
.uf-card .uf-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--uf-faint)}
.uf-overlay.color .uf-card .uf-dot{background:var(--uf-kc,var(--uf-faint))}
.uf-card .uf-cname{font-weight:500;font-size:13px;color:var(--uf-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-card.sym .uf-cname{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.uf-card .uf-cmeta{color:var(--uf-faint);font-size:10.5px;font-family:ui-monospace,Menlo,monospace;margin-top:4px}
.uf-card .uf-cdesc{color:var(--uf-ink2);font-size:11.5px;line-height:1.5;margin-top:6px;
  display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.uf-card .uf-open{position:absolute;top:0;right:0;width:25px;height:100%;display:flex;align-items:center;
  justify-content:center;color:var(--uf-faint);opacity:0;transition:opacity .15s}
.uf-card:hover .uf-open{opacity:1}
.uf-card .uf-open:hover{color:var(--uf-accent)}
.uf-card .uf-open svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.uf-card.can-open{padding-right:25px}
.uf-card.sel{border-color:var(--uf-accent);box-shadow:0 0 0 1px var(--uf-accent),var(--uf-shadow-lift)}
.uf-card.nbr{border-color:var(--uf-accent-line)}
.uf-card.dim{opacity:.32}
.uf-card.bh1{border-color:color-mix(in srgb,var(--uf-accent) 62%,var(--uf-line));box-shadow:0 0 0 1px var(--uf-accent-line),var(--uf-shadow-lift)}
.uf-card.bh2{border-color:color-mix(in srgb,var(--uf-accent) 36%,var(--uf-line))}
.uf-card.bh3{border-color:color-mix(in srgb,var(--uf-accent) 18%,var(--uf-line))}
.uf-card .uf-bhop{position:absolute;top:-7px;left:10px;font-family:ui-monospace,Menlo,monospace;font-size:9px;
  color:var(--uf-accent);background:var(--uf-surface);border:1px solid var(--uf-accent-line);border-radius:5px;padding:0 4px;line-height:12px}
.uf-overlay:not(.metrics) .uf-card .uf-cmeta{display:none}
.uf-overlay:not(.desc) .uf-card .uf-cdesc{display:none}
.uf-iface{margin-top:8px;border-top:1px solid var(--uf-hair);padding-top:7px}
.uf-iface .uf-ilab{color:var(--uf-faint);font-size:8.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;font-family:ui-monospace,Menlo,monospace}
.uf-iface .uf-irow{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--uf-ink2);margin:3px 0 0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px}
.uf-iface .uf-vn{color:var(--uf-dim)}
.uf-overlay:not(.iface) .uf-card .uf-iface{display:none}
.uf-overlay.iface .uf-card.sym{min-width:220px;max-width:280px}

.uf-panel{width:330px;flex:none;border-left:1px solid var(--uf-line);background:var(--uf-bg);overflow-y:auto;overflow-x:hidden;z-index:30}
.uf-sec{border-bottom:1px solid var(--uf-line)}
.uf-sech{display:flex;align-items:center;gap:8px;padding:13px 16px 5px;color:var(--uf-dim);font-size:10.5px;font-weight:600;letter-spacing:.13em}
.uf-sech .uf-n{margin-left:auto;color:var(--uf-faint);font-family:ui-monospace,Menlo,monospace;font-weight:400}
.uf-secb{padding:4px 10px 14px}
.uf-layer{display:flex;align-items:center;gap:10px;padding:7px 6px;border-radius:8px;cursor:pointer}
.uf-layer:hover{background:var(--uf-surface2)}
.uf-layer .uf-sw{width:30px;height:18px;border-radius:10px;background:var(--uf-line);position:relative;flex:none;transition:background .18s}
.uf-layer .uf-sw::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  background:var(--uf-surface);box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .2s var(--uf-ease)}
.uf-layer.on .uf-sw{background:var(--uf-accent)}
.uf-layer.on .uf-sw::after{transform:translateX(12px)}
.uf-layer .uf-lt{font-size:12.5px;color:var(--uf-ink)}
.uf-layer .uf-ld{font-size:10.5px;color:var(--uf-faint);margin-top:1px}
.uf-search{width:100%;height:32px;padding:0 11px;border:1px solid var(--uf-line);border-radius:8px;background:var(--uf-surface);
  color:var(--uf-ink);font-size:12.5px;margin:2px 0 7px}
.uf-search::placeholder{color:var(--uf-faint)}
.uf-trow{display:flex;align-items:center;gap:6px;min-height:26px;border-radius:7px;padding:0 6px;cursor:pointer}
.uf-trow:hover{background:var(--uf-surface2)}
.uf-trow .uf-ttw{width:14px;flex:none;display:flex;align-items:center;justify-content:center;color:var(--uf-faint)}
.uf-trow .uf-ttw svg{width:8px;height:8px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s}
.uf-trow.open>.uf-ttw svg{transform:rotate(90deg)}
.uf-trow .uf-tlabel{font-size:12px;color:var(--uf-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.uf-trow.on .uf-tlabel{color:var(--uf-ink)}
.uf-trow.leaf .uf-tlabel{font-family:ui-monospace,Menlo,monospace;font-size:11px}
.uf-trow.sel{background:var(--uf-accent-soft)}
.uf-trow .uf-tchk{width:14px;height:14px;flex:none;border:1.4px solid var(--uf-line);border-radius:4px;position:relative}
.uf-trow.on .uf-tchk{background:var(--uf-accent);border-color:var(--uf-accent)}
.uf-trow.on .uf-tchk::after{content:'';position:absolute;left:4px;top:1px;width:4px;height:8px;
  border:solid var(--uf-surface);border-width:0 2px 2px 0;transform:rotate(45deg)}
.uf-tkids{display:none;margin-left:13px;border-left:1px solid var(--uf-line-soft);padding-left:2px}
.uf-tkids.open{display:flex;flex-direction:column}
.uf-insp .uf-ihead{padding:14px 16px 11px}
.uf-insp .uf-ikind{display:inline-block;font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
  font-family:ui-monospace,Menlo,monospace;color:var(--uf-dim);border:1px solid var(--uf-line);border-radius:5px;padding:2px 7px;margin-bottom:8px}
.uf-insp .uf-iname{font-size:17px;font-weight:600;line-height:1.25;word-break:break-word}
.uf-insp .uf-iname.uf-mono{font-size:14px}
.uf-insp .uf-ipath{color:var(--uf-faint);font-size:11px;font-family:ui-monospace,Menlo,monospace;margin-top:5px;word-break:break-word}
.uf-insp .uf-idesc{color:var(--uf-ink2);font-size:12.5px;line-height:1.6;margin-top:10px}
.uf-insp .uf-iact{display:flex;gap:8px;margin-top:12px}
.uf-insp .uf-ibtn{flex:1;text-align:center;height:32px;line-height:30px;border:1px solid var(--uf-line);border-radius:8px;
  background:var(--uf-surface);color:var(--uf-ink2);font-size:12px}
.uf-insp .uf-ibtn.pri{border-color:var(--uf-accent-line);color:var(--uf-accent);background:var(--uf-accent-soft)}
.uf-insp .uf-ibtn:hover{border-color:var(--uf-faint);color:var(--uf-ink)}
.uf-ilab2{color:var(--uf-dim);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin:0 0 6px}
.uf-iline{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--uf-ink2);margin:3px 0;white-space:pre-wrap;word-break:break-word}
.uf-iline .uf-vn{color:var(--uf-dim)}
.uf-conn{display:flex;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--uf-line);border-radius:8px;
  background:var(--uf-surface);cursor:pointer;margin-bottom:5px}
.uf-conn:hover{border-color:var(--uf-accent-line)}
.uf-conn .uf-arw{color:var(--uf-faint);font-size:12px;flex:none}
.uf-conn .uf-cn{font-size:12px;color:var(--uf-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uf-conn .uf-cl{color:var(--uf-faint);font-size:10px;margin-left:auto;font-family:ui-monospace,Menlo,monospace;flex:none}
.uf-body{margin-top:4px;background:var(--uf-surface2);border:1px solid var(--uf-line);border-radius:8px;overflow:auto;max-height:320px}
.uf-body pre{margin:0;padding:11px 13px;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;line-height:1.6;color:var(--uf-ink2);white-space:pre}
.uf-blk{padding:11px 16px;border-top:1px solid var(--uf-line)}

/* ---- v3 "stage": entrance stagger (approved motion contract) ---- */
.uf-card.uf-born{opacity:0;transform:translateY(10px) scale(.97)}
.uf-card.uf-in{opacity:1;transform:none;transition:opacity .65s cubic-bezier(.16,1,.3,1),transform .65s cubic-bezier(.16,1,.3,1)}
.uf-wires path.uf-enter,.uf-swires path.uf-enter{stroke-dasharray:1;stroke-dashoffset:1;animation:ufDraw .9s cubic-bezier(.16,1,.3,1) forwards}
@keyframes ufDraw{to{stroke-dashoffset:0}}
.uf-wires path.uf-hot,.uf-swires path.uf-hot{stroke-dasharray:7 9;animation:ufFlow 1.1s linear infinite}
@keyframes ufFlow{to{stroke-dashoffset:-16}}

/* ---- v3 "stage": type focus ---- */
.uf-t{cursor:pointer;border-bottom:1px dotted var(--uf-faint)}
.uf-t:hover,.uf-t.hit{color:var(--uf-accent);border-bottom-color:var(--uf-accent)}
.uf-card.lit{border-color:var(--uf-accent);box-shadow:0 0 0 1px var(--uf-accent-line)}

/* ---- v3 "stage": stage projection (world blurs behind; group center-stage) ---- */
.uf-world{transition:opacity .7s,filter .7s}
.uf-world.anim{transition:transform .42s var(--uf-ease),opacity .7s,filter .7s}
.uf-world.anim2{transition:transform .9s cubic-bezier(.16,1,.3,1),opacity .7s,filter .7s}
.uf-overlay.staged .uf-world{opacity:.16;filter:blur(5px) saturate(.6);pointer-events:none}
.uf-stagelayer{position:absolute;inset:0;z-index:10;pointer-events:none}
.uf-overlay.staged .uf-stagelayer{pointer-events:auto}
.uf-swires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.uf-sgroup{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);opacity:0;
  transition:opacity .6s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1);
  background:var(--uf-surface);border:1px solid var(--uf-line);border-radius:18px;
  padding:26px 30px 30px;max-width:720px;box-shadow:var(--uf-shadow-lift)}
.uf-overlay.staged .uf-sgroup{opacity:1;transform:translate(-50%,-50%)}
.uf-shead{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.uf-slabel{font-size:19px;font-weight:300;line-height:1}
.uf-strail{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--uf-faint)}
.uf-sleave{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--uf-dim);padding:3px 9px;border-radius:6px}
.uf-sleave:hover{color:var(--uf-ink);background:var(--uf-hair)}
.uf-sbody{display:flex;flex-wrap:wrap;gap:11px;max-width:640px}
.uf-proxy{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;
  background:var(--uf-surface);border:1px solid var(--uf-line);border-radius:99px;
  padding:8px 16px;display:flex;align-items:center;gap:9px;white-space:nowrap;
  box-shadow:var(--uf-shadow);font-family:ui-monospace,Menlo,monospace;font-size:12px;
  opacity:0;transition:opacity .5s cubic-bezier(.16,1,.3,1),transform .45s cubic-bezier(.16,1,.3,1),border-color .3s,border-radius .35s}
.uf-overlay.staged .uf-proxy{opacity:1}
.uf-proxy:hover{border-color:var(--uf-accent)}
.uf-pdot{width:7px;height:7px;border-radius:99px;background:var(--uf-accent);flex:none}
.uf-pgrp{color:var(--uf-faint);font-size:10px}
.uf-proxy.peek{border-radius:14px;white-space:normal;flex-direction:column;align-items:flex-start;gap:6px;padding:14px 16px;width:230px;cursor:default}
.uf-ptitle{font-weight:600}
.uf-pdesc{font-size:11px;line-height:1.5;color:var(--uf-ink2);font-family:Inter,-apple-system,sans-serif}
.uf-pdesc b{font-family:ui-monospace,Menlo,monospace}
.uf-ptravel{align-self:flex-end;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--uf-accent);
  padding:4px 10px;border:1px solid var(--uf-accent-line);border-radius:99px;background:var(--uf-accent-soft)}
.uf-ptravel:hover{background:var(--uf-accent);color:var(--uf-surface)}
@media (prefers-reduced-motion:reduce){.uf-overlay *,.uf-wires path,.uf-swires path{animation:none!important;transition:none!important}}

/* ---- trust layer: advisory claims and edges are visibly weaker than code-backed ones ---- */
.uf-overlay.trust .uf-cdesc,.uf-overlay.trust .uf-idesc{border-left:2px solid var(--uf-k-store);padding-left:7px}
.uf-conn .uf-cl.adv{color:var(--uf-k-store)}
.uf-layer.off{opacity:.55;cursor:default}
.uf-layer.off .uf-sw{opacity:.4}
.uf-layer .uf-load{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--uf-accent);
  border:1px solid var(--uf-accent-line);border-radius:6px;padding:2px 7px;background:var(--uf-accent-soft);flex:none;cursor:pointer}

/* ---- rename in place ---- */
.uf-card .uf-cname[contenteditable]{outline:1px solid var(--uf-accent);border-radius:4px;padding:0 3px;
  white-space:normal;overflow:visible;text-overflow:clip;min-width:40px}

/* ---- frontmatter editor mounted in the reading inspector ---- */
.uf-insp .fm-input{width:100%;border:1px solid var(--uf-line);border-radius:7px;background:var(--uf-surface);
  color:var(--uf-ink);font:inherit;font-size:12px;padding:5px 8px;margin:2px 0}
.uf-insp .fm-area{resize:vertical;min-height:40px}
.uf-insp .fm-listrow{display:flex;gap:5px;align-items:center}
.uf-insp .fm-listrow .fm-input{flex:1;min-width:0}
.uf-insp .fm-x,.uf-insp .fm-add{flex:none;color:var(--uf-dim);font-size:11px;border:1px solid var(--uf-line);
  border-radius:6px;padding:2px 7px;background:var(--uf-surface);cursor:pointer}
.uf-insp .fm-x:hover,.uf-insp .fm-add:hover{color:var(--uf-ink);border-color:var(--uf-faint)}
.uf-insp .fm-listhead{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
.uf-insp .fm-listhead label{font-size:10px;color:var(--uf-dim);text-transform:uppercase;letter-spacing:.08em}
.uf-insp .insp-sec-title{display:flex;justify-content:space-between;color:var(--uf-dim);font-size:10.5px;
  font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}
.uf-insp .fm-hint{color:var(--uf-faint);font-weight:400;text-transform:none;letter-spacing:0}
.uf-insp .field{margin:6px 0}
.uf-insp .field label{display:block;font-size:10px;color:var(--uf-dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}
.uf-insp .fm-iface{border:1px solid var(--uf-line);border-radius:8px;padding:8px;margin-top:8px}
.uf-insp .fm-iface-head .fm-iface-name{font-family:ui-monospace,Menlo,monospace}
.uf-insp .filebtn{margin-top:10px;font-size:11px;color:var(--uf-dim);border:1px solid var(--uf-line);
  border-radius:7px;padding:4px 10px;background:var(--uf-surface);cursor:pointer}
.uf-insp .filebtn:hover{color:var(--uf-ink);border-color:var(--uf-faint)}
`;

const KIND_VAR: Record<string, string> = {
  type: '--uf-k-type', function: '--uf-k-function', module: '--uf-k-module', group: '--uf-k-module',
  store: '--uf-k-store', class: '--uf-k-class', hook: '--uf-k-function', service: '--uf-k-store',
  event: '--uf-k-store', component: '--uf-k-class',
};

const LAYER_DEFS: Array<{ k: string; t: string; d: string }> = [
  { k: 'calls',   t: 'calls',         d: 'solid call wires' },
  { k: 'deps',    t: 'dependencies',  d: 'dotted dependency wires' },
  { k: 'desc',    t: 'descriptions',  d: 'one-line role under each name' },
  { k: 'iface',   t: 'interfaces',    d: 'accepts / returns on cards' },
  { k: 'metrics', t: 'metrics',       d: 'child counts · fan-in' },
  { k: 'color',   t: 'colour',        d: 'tint by kind' },
  { k: 'trust',   t: 'trust',         d: 'mark advisory claims and edges' },
  { k: 'blast',   t: 'blast radius',  d: 'ripple what depends on the selection' },
];

export function initUnfold(ctx: AppContext, deps: { selection: SelectionApi; camera: CameraApi }): UnfoldApi {
  /* ---- inject CSS once ---- */
  if (!document.getElementById('unfoldCss')) {
    const st = document.createElement('style');
    st.id = 'unfoldCss';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---- overlay DOM ---- */
  const overlay = document.createElement('div');
  overlay.className = 'uf-overlay';
  overlay.id = 'unfoldOverlay';
  overlay.innerHTML = `
    <div class="uf-stage" id="ufStage">
      <div class="uf-world" id="ufWorld"><svg class="uf-wires" id="ufWires"></svg><div class="uf-content" id="ufContent"></div></div>
      <div class="uf-dock">
        <button id="ufZin" title="Zoom in"><svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8"/></svg></button>
        <button id="ufZout" title="Zoom out"><svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg></button>
        <button id="ufZfit" title="Fit to view"><svg viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg></button>
        <span class="uf-gap"></span>
        <button id="ufFold" title="Fold everything"><svg viewBox="0 0 16 16"><path d="M8 2v5M8 9v5M3 8h10"/><path d="M5.5 5.5 8 3l2.5 2.5"/><path d="M5.5 10.5 8 13l2.5-2.5"/></svg></button>
        <button id="ufTheme" title="Light / dark"><svg viewBox="0 0 16 16" id="ufThemeIc"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z"/></svg></button>
        <button id="ufClose" title="Back to the editor (Esc)"><svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13"/></svg></button>
      </div>
      <div class="uf-hint" id="ufHint"></div>
    </div>
    <aside class="uf-panel">
      <div class="uf-sec"><div class="uf-sech">reveal</div><div class="uf-secb" id="ufLayers"></div></div>
      <div class="uf-sec"><div class="uf-sech">browse <span class="uf-n" id="ufCount"></span></div>
        <div class="uf-secb"><input class="uf-search" id="ufSearch" placeholder="find…"><div id="ufTree"></div></div></div>
      <div class="uf-sec"><div class="uf-insp" id="ufInsp"></div></div>
    </aside>`;
  document.body.appendChild(overlay);

  const q = (id: string): HTMLElement => overlay.querySelector('#' + id) as HTMLElement;
  const stageEl = q('ufStage'), worldEl = q('ufWorld'), contentEl = q('ufContent');
  const wiresEl = q('ufWires') as unknown as SVGSVGElement;
  const h = (tag: string, cls?: string, html?: string): HTMLElement => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* ================= MODEL (derived from ctx.state on open) ================= */
  const U = new Map<string, UNode>();
  let ROOTS: string[] = [];
  let EDGES: UEdge[] = [];
  const OUT: Record<string, UEdge[]> = {}, IN: Record<string, UEdge[]> = {};

  const prefixParent = (id: string): string | null => {
    const i = id.indexOf('__');
    return i > 0 && ctx.state.nodes[id.slice(0, i)] ? id.slice(0, i) : null;
  };
  function parentOf(n: DiagramNode): string | null {
    if (n.parent && ctx.state.nodes[n.parent]) return n.parent;
    return prefixParent(n.id);
  }

  function build(): void {
    U.clear(); ROOTS = []; EDGES = [];
    for (const k of Object.keys(OUT)) delete OUT[k];
    for (const k of Object.keys(IN)) delete IN[k];
    for (const id in ctx.state.nodes) {
      const n = ctx.state.nodes[id];
      const accepts: string[] = [], returns: string[] = [];
      for (const i of n.fm?.interfaces ?? []) {
        accepts.push(...i.accepts);
        returns.push(...i.returns.filter((r) => r && r !== 'void'));
      }
      U.set(id, {
        id,
        label: n.fm?.name || n.label || id,
        kind: n.kind ?? (n.shape === 'group' ? 'group' : 'node'),
        desc: n.fm?.description ?? '',
        accepts, returns, state: n.fm?.state ?? [],
        children: [], parent: null, fanIn: 0,
      });
    }
    for (const id in ctx.state.nodes) {
      const p = parentOf(ctx.state.nodes[id]);
      const u = U.get(id) as UNode;
      if (p && p !== id && U.has(p)) {
        u.parent = p;
        (U.get(p) as UNode).children.push(id);
      }
    }
    // %% group hierarchy: declared groups become container levels ABOVE the
    // containment roots — the reading surface's regions. No geometry, no canvas
    // presence; a collision with a real node id lets the node win.
    const hier = ctx.state.hier;
    if (hier && Object.keys(hier.groups).length) {
      for (const gid of Object.keys(hier.groups)) {
        if (U.has(gid)) continue;
        const g = hier.groups[gid];
        U.set(gid, {
          id: gid, label: g.label, kind: 'group', desc: '',
          accepts: [], returns: [], state: [], children: [], parent: null, fanIn: 0,
        });
      }
      for (const gid of Object.keys(hier.groups)) {
        const p = hier.groups[gid].parent;
        const u = U.get(gid);
        if (u && p && U.has(p) && !u.parent && p !== gid) { u.parent = p; (U.get(p) as UNode).children.push(gid); }
      }
      for (const nid of Object.keys(hier.memberOf)) {
        const u = U.get(nid), gid = hier.memberOf[nid];
        if (u && !u.parent && U.has(gid)) { u.parent = gid; (U.get(gid) as UNode).children.push(nid); }
      }
    }
    for (const [id, u] of U) if (!u.parent) ROOTS.push(id);
    const seen = new Map<string, UEdge>();
    for (const e of ctx.state.edges) {
      if (e.from === e.to || !U.has(e.from) || !U.has(e.to)) continue;
      const k = e.from + ' ' + e.to;
      if (!seen.has(k)) seen.set(k, { from: e.from, to: e.to, label: '', call: false, dep: false, w: 0 });
      const s = seen.get(k) as UEdge;
      s.w++;
      if (e.style === 'dotted') s.dep = true; else s.call = true;
      if (e.label && s.label.length < 40) s.label = [s.label, e.label].filter(Boolean).join(', ');
    }
    EDGES = [...seen.values()];
    for (const id of U.keys()) { OUT[id] = []; IN[id] = []; }
    for (const e of EDGES) { OUT[e.from].push(e); IN[e.to].push(e); }
    for (const id of U.keys()) (U.get(id) as UNode).fanIn = new Set(IN[id].map((e) => e.from)).size;
    // drop stale view state that no longer resolves
    for (const id of [...expanded]) if (!U.has(id)) expanded.delete(id);
    for (const id of [...hidden]) if (!U.has(id)) hidden.delete(id);
    if (SEL && !U.has(SEL)) SEL = null;
  }
  const gu = (id: string): UNode => U.get(id) as UNode;
  const isContainer = (u: UNode | undefined): boolean => !!u && u.children.length > 0;

  /* ================= VIEW STATE ================= */
  const expanded = new Set<string>();
  const hidden = new Set<string>();
  let SEL: string | null = null, QUERY = '';
  // wires are the story, never an opt-in (approved design decision #1): calls default ON for a fresh view
  const layers: Record<string, boolean> = {
    calls: true, deps: false, desc: false, iface: false, metrics: false, color: false, trust: false, blast: false,
  };

  /** selection survives the mode boundary: seed SEL from the editor on open; hand
      the reading selection back (selectOnly + zoomToNode) on close. No new state —
      the two surfaces share one selection. */
  function selectSync(dir: 'open' | 'close'): void {
    if (dir === 'open') {
      const first = [...ctx.state.sel].find((id) => U.has(id));
      if (first) { SEL = first; revealNode(first); }
      return;
    }
    if (SEL && ctx.state.nodes[SEL]) {
      deps.selection.selectOnly(SEL);
      deps.camera.zoomToNode(SEL);
    }
  }

  /** reading session per diagram (sorted containment roots as identity):
      expanded/hidden/layers survive close and reload; a never-read diagram
      still arrives fully folded, all layers off. */
  function persistView(dir: 'save' | 'load'): void {
    try {
      const key = 'unfold.view';
      const all = JSON.parse(localStorage.getItem(key) ?? '{}') as
        Record<string, { expanded?: string[]; hidden?: string[]; layers?: Record<string, boolean> }>;
      const fp = [...ROOTS].sort().join('|');
      if (!fp) return;
      if (dir === 'save') {
        all[fp] = { expanded: [...expanded], hidden: [...hidden], layers: { ...layers } };
        const keys = Object.keys(all);
        while (keys.length > 24) delete all[keys.shift() as string];
        localStorage.setItem(key, JSON.stringify(all));
        return;
      }
      const v = all[fp];
      expanded.clear(); hidden.clear();
      (v?.expanded ?? []).forEach((id) => { if (U.has(id)) expanded.add(id); });
      (v?.hidden ?? []).forEach((id) => { if (U.has(id)) hidden.add(id); });
      // stored layer prefs win; a never-read diagram still arrives with the calls story ON
      const stored = v?.layers;
      for (const k of Object.keys(layers)) {
        layers[k] = stored ? !!stored[k] && (k !== 'trust' || TRUST_SRC) : k === 'calls';
      }
    } catch { /* storage unavailable — the session just doesn't persist */ }
  }

  function isRendered(id: string): boolean {
    let u = U.get(id);
    const seen = new Set<string>();
    while (u) {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      if (hidden.has(u.id)) return false;
      if (!u.parent) return true;
      if (!expanded.has(u.parent)) return false;
      u = U.get(u.parent);
    }
    return true;
  }
  function visibleRep(id: string): string | null {
    let u = U.get(id);
    const seen = new Set<string>();
    while (u) {
      if (seen.has(u.id)) return null;
      seen.add(u.id);
      if (isRendered(u.id)) return u.id;
      u = u.parent ? U.get(u.parent) : undefined;
    }
    return null;
  }
  function revealNode(id: string): void {
    let u = U.get(id);
    const chain: string[] = [], seen = new Set<string>();
    while (u && !seen.has(u.id)) { seen.add(u.id); chain.push(u.id); u = u.parent ? U.get(u.parent) : undefined; }
    chain.forEach((c) => hidden.delete(c));
    chain.slice(1).forEach((c) => expanded.add(c));
  }

  /* ---- blast radius: transitive dependents of the selection ---- */
  let BLAST_N = 0;
  let REP_HOPS = new Map<string, number>();
  function computeBlast(): void {
    REP_HOPS = new Map(); BLAST_N = 0;
    if (!layers.blast || !SEL) return;
    const hop = new Map<string, number>([[SEL, 0]]);
    const bq: string[] = [SEL];
    while (bq.length) {
      const x = bq.shift() as string;
      for (const e of IN[x] ?? []) if (!hop.has(e.from)) { hop.set(e.from, (hop.get(x) ?? 0) + 1); bq.push(e.from); }
    }
    hop.delete(SEL);
    BLAST_N = hop.size;
    const selRep = visibleRep(SEL);
    for (const [id, hp] of hop) {
      const rep = visibleRep(id);
      if (!rep || rep === selRep) continue;
      const cur = REP_HOPS.get(rep);
      if (cur == null || hp < cur) REP_HOPS.set(rep, hp);
    }
  }

  /* ================= CAMERA (bounded) ================= */
  const Z = { x: 0, y: 0, k: 1 };
  function setT(anim?: boolean): void {
    worldEl.classList.toggle('anim', !!anim);
    worldEl.style.transform = `translate(${Z.x}px,${Z.y}px) scale(${Z.k})`;
  }
  const contentSize = (): { w: number; h: number } => ({ w: contentEl.scrollWidth || 1, h: contentEl.scrollHeight || 1 });
  function clampPan(): void {
    const { w, h: hh } = contentSize(), sw = stageEl.clientWidth, sh = stageEl.clientHeight, m = 120;
    Z.x = Math.min(sw - m, Math.max(m - w * Z.k, Z.x));
    Z.y = Math.min(sh - m, Math.max(m - hh * Z.k, Z.y));
  }
  function fitView(anim?: boolean): void {
    const { w, h: hh } = contentSize(), sw = stageEl.clientWidth, sh = stageEl.clientHeight, pad = 64;
    Z.k = Math.max(.15, Math.min(1.15, Math.min((sw - pad * 2) / w, (sh - pad * 2) / hh)));
    Z.x = (sw - w * Z.k) / 2;
    Z.y = Math.max(pad, (sh - hh * Z.k) / 2);
    setT(anim);
  }
  stageEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stageEl.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const k2 = Math.max(.15, Math.min(2.5, Z.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    Z.x = px - (px - Z.x) * (k2 / Z.k);
    Z.y = py - (py - Z.y) * (k2 / Z.k);
    Z.k = k2;
    clampPan(); setT(false);
  }, { passive: false });
  let panDrag: { sx: number; sy: number; x: number; y: number } | null = null;
  stageEl.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.uf-card,.uf-ghead,.uf-open,.uf-dock')) return;
    panDrag = { sx: e.clientX, sy: e.clientY, x: Z.x, y: Z.y };
    stageEl.classList.add('grab');
    stageEl.setPointerCapture(e.pointerId);
  });
  stageEl.addEventListener('pointermove', (e) => {
    if (!panDrag) return;
    Z.x = panDrag.x + (e.clientX - panDrag.sx);
    Z.y = panDrag.y + (e.clientY - panDrag.sy);
    clampPan(); setT(false);
  });
  stageEl.addEventListener('pointerup', () => { panDrag = null; stageEl.classList.remove('grab'); });

  /* ================= CANVAS ================= */
  function depthOf(id: string): number {
    let d = 0, u = U.get(id);
    const seen = new Set<string>();
    while (u && u.parent && !seen.has(u.id)) { seen.add(u.id); d++; u = U.get(u.parent); }
    return d;
  }
  function renderCanvas(): void {
    contentEl.innerHTML = '';
    const wrap = h('div');
    wrap.style.cssText = 'display:flex;gap:28px;align-items:flex-start;padding:52px;flex-wrap:wrap;max-width:2200px';
    for (const rid of ROOTS) if (isRendered(rid)) wrap.appendChild(nodeEl(rid));
    contentEl.appendChild(wrap);
  }
  const nodeEl = (id: string): HTMLElement =>
    expanded.has(id) && isContainer(U.get(id)) ? groupEl(gu(id)) : cardEl(gu(id));
  function groupEl(u: UNode): HTMLElement {
    const kids = u.children.filter((c) => !hidden.has(c));
    const allLeaf = kids.every((c) => !(expanded.has(c) && isContainer(U.get(c))));
    const g = h('div', 'uf-grp open ' + (allLeaf ? 'leaf' : depthOf(u.id) % 2 === 0 ? 'row' : 'col'));
    g.dataset.id = u.id;
    const head = h('div', 'uf-ghead',
      `<span class="uf-tw"><svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg></span>
       <span class="uf-gname">${esc(u.label)}</span>
       <span class="uf-gcount">${kids.length}/${u.children.length}</span>`);
    head.onclick = () => toggleExpand(u.id);
    g.appendChild(head);
    const body = h('div', 'uf-gbody');
    for (const c of kids) body.appendChild(nodeEl(c));
    g.appendChild(body);
    return g;
  }
  function cardEl(u: UNode): HTMLElement {
    const canOpen = isContainer(u);
    const clickOpens = canOpen && (u.kind === 'group' || u.kind === 'node');
    const sel = SEL === u.id;
    const blastOn = layers.blast && !!SEL;
    const hop = blastOn ? REP_HOPS.get(u.id) : undefined;
    const nbr = !blastOn && SEL ? !sel && isNeighbour(SEL, u.id) : false;
    const dim = blastOn ? !sel && hop == null : (SEL ? !sel && !nbr : false);
    const c = h('div', 'uf-card ' + (SYM_KINDS.has(u.kind) ? 'sym ' : '') + (canOpen && !clickOpens ? 'can-open ' : '')
      + (sel ? 'sel ' : '') + (nbr ? 'nbr ' : '') + (hop != null ? 'bh' + Math.min(3, hop) + ' ' : '') + (dim ? 'dim' : ''));
    c.dataset.id = u.id;
    if (layers.color) c.style.setProperty('--uf-kc', `var(${KIND_VAR[u.kind] ?? '--uf-k-function'})`);
    const meta = canOpen ? `${u.children.length} inside · fan-in ${u.fanIn}` : `${u.kind} · fan-in ${u.fanIn}`;
    c.innerHTML = `<div class="uf-crow"><span class="uf-dot"></span><span class="uf-cname">${esc(u.label)}</span></div>
      <div class="uf-cmeta">${esc(meta)}</div>
      ${u.desc ? `<div class="uf-cdesc">${esc(u.desc)}</div>` : ''}
      ${ifaceHtml(u)}
      ${hop != null ? `<span class="uf-bhop">${hop}</span>` : ''}
      ${canOpen && !clickOpens ? `<span class="uf-open" title="Unfold"><svg viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg></span>` : ''}`;
    c.onclick = (ev) => {
      if ((ev.target as HTMLElement).isContentEditable) return;
      if ((ev.target as HTMLElement).closest('.uf-open')) return;
      if (clickOpens) toggleExpand(u.id); else select(u.id);
    };
    if (canOpen && !clickOpens) {
      (c.querySelector('.uf-open') as HTMLElement).onclick = (ev) => { ev.stopPropagation(); toggleExpand(u.id); };
    }
    c.ondblclick = (ev) => {
      if ((ev.target as HTMLElement).isContentEditable) return;
      if (canOpen) toggleExpand(u.id);
      else if (SEL === u.id) renameInPlace(u.id);
    };
    return c;
  }
  function ifaceHtml(u: UNode): string {
    const rows: string[] = [];
    const R = (l: string, a: string[]): void => {
      if (a.length) rows.push(`<div class="uf-ilab">${l}</div>` + a.slice(0, 4).map((x) => `<div class="uf-irow">${ifaceLine(x)}</div>`).join(''));
    };
    R('accepts', u.accepts); R('returns', u.returns); R('state', u.state);
    return rows.length ? `<div class="uf-iface">${rows.join('')}</div>` : '';
  }
  function ifaceLine(raw: string): string {
    const i = raw.indexOf(':');
    const name = i >= 0 ? raw.slice(0, i) : '';
    const typ = (i >= 0 ? raw.slice(i + 1) : raw).trim();
    const base = typ.replace(/\[\]$/, '');
    const tok = `<span class="uf-t" data-t="${esc(base)}">${esc(typ)}</span>`;
    return name ? `<span class="uf-vn">${esc(name)}:</span> ${tok}` : tok;
  }
  const isNeighbour = (a: string, b: string): boolean => {
    const ra = visibleRep(a);
    return EDGES.some((e) =>
      (visibleRep(e.from) === ra && visibleRep(e.to) === b) || (visibleRep(e.to) === ra && visibleRep(e.from) === b));
  };

  /* ================= WIRES ================= */
  function box(el: HTMLElement): Box {
    const r = el.getBoundingClientRect(), cr = contentEl.getBoundingClientRect(), k = Z.k;
    return {
      x: (r.left - cr.left) / k, y: (r.top - cr.top) / k, w: r.width / k, h: r.height / k,
      cx: (r.left - cr.left) / k + r.width / k / 2, cy: (r.top - cr.top) / k + r.height / k / 2,
    };
  }
  /** ONE wire geometry, not two: nearest facing ports from core/state (portPos/bestSides)
      and the render/wires elbow path — the one-way reuse the arch sandbox proved. */
  function wirePath(a: Box, b: Box): string {
    const na: DiagramNode = { id: '', label: '', shape: 'rect', color: null, x: a.x, y: a.y, w: a.w, h: a.h };
    const nb: DiagramNode = { id: '', label: '', shape: 'rect', color: null, x: b.x, y: b.y, w: b.w, h: b.h };
    const [sa, sb] = bestSides(na, nb);
    return elbowPath(portPos(na, sa), sa, portPos(nb, sb), sb);
  }

  /* ---- trust: A5 advisory edges from an OPTIONAL source ---- */
  const ALLOW = new Set<string>();
  let TRUST_SRC = false;
  let trustFileEl: HTMLInputElement;
  function parseAllow(text: string): void {
    ALLOW.clear();
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('->')) continue;
      ALLOW.add(t);
    }
  }
  /** trust layer with an OPTIONAL advisory source: the same-origin allowlist when present
      (this repo, dev server), a Load button otherwise (any repo). Absent source = the
      layer stays disabled — it never marks anything it cannot back. */
  function trustLayer(): void {
    trustFileEl = document.createElement('input');
    trustFileEl.type = 'file';
    trustFileEl.accept = '.txt,text/plain';
    trustFileEl.onchange = () => {
      const f = trustFileEl.files?.[0];
      if (!f) return;
      void f.text().then((t) => { parseAllow(t); TRUST_SRC = true; renderLayers(); render(false); });
    };
    fetch('docs/flowmap/edge-advisory-allowlist.txt')
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('text/plain') ? r.text() : null))
      .then((t) => {
        if (t == null || !t.includes('->')) return;
        parseAllow(t);
        TRUST_SRC = true;
        renderLayers();
      })
      .catch(() => { /* no same-origin source — the Load button remains the door */ });
  }
  const cvar = (n: string): string => getComputedStyle(overlay).getPropertyValue(n).trim();

  /* ---- obstacle-avoided wire routes (libavoid, shared worker): elbows paint first,
         the routed polylines upgrade them when the reply lands — same doctrine as the
         editor canvas. Keyed by a layout signature so a stale reply is dropped. ---- */
  let ROUTE_SIG = '';
  let routeSeq = 0;
  const ROUTES = new Map<string, Point[]>();
  function requestRoutes(pos: Record<string, Box>, pairs: { a: string; b: string }[]): void {
    const sig = Object.keys(pos).sort().map((id) => {
      const b2 = pos[id];
      return `${id}:${Math.round(b2.x)},${Math.round(b2.y)},${Math.round(b2.w)},${Math.round(b2.h)}`;
    }).join('|') + '||' + pairs.map((p2) => p2.a + '>' + p2.b).sort().join(';');
    if (sig === ROUTE_SIG) return;
    ROUTE_SIG = sig;
    ROUTES.clear();
    if (!pairs.length) return;
    const rects: AdhocRect[] = [];
    contentEl.querySelectorAll<HTMLElement>('.uf-card,.uf-ghead').forEach((el, i2) => {
      const b2 = box(el);
      rects.push({ id: el.dataset.id ?? `__h${i2}`, x: b2.x, y: b2.y, width: b2.w, height: b2.h });
    });
    const edges: AdhocEdge[] = pairs.map((p2) => ({ id: p2.a + ' ' + p2.b, source: p2.a, target: p2.b }));
    const mySeq = ++routeSeq;
    void routeGraph(rects, edges).then((routes) => {
      if (mySeq !== routeSeq || sig !== ROUTE_SIG) return; // layout moved on — drop
      for (const r of routes) ROUTES.set(r.id, r.poly);
      if (routes.length) drawWires();                      // repaint upgrades elbows in place
    });
  }

  function drawWires(): void {
    wiresEl.innerHTML = '';
    if (!layers.calls && !layers.deps) return;
    const { w, h: hh } = contentSize();
    wiresEl.setAttribute('width', String(w));
    wiresEl.setAttribute('height', String(hh));
    const edgeCol = cvar('--uf-dim') || '#948f84', selCol = cvar('--uf-accent') || '#4a6b8a';
    const advCol = cvar('--uf-k-store') || '#a8824a';
    const defs = document.createElementNS(NS, 'defs');
    const mk = (id: string, col: string, sw: number): SVGMarkerElement => {
      const m = document.createElementNS(NS, 'marker');
      m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 8 8');
      m.setAttribute('refX', '6.2'); m.setAttribute('refY', '4');
      m.setAttribute('markerWidth', '6'); m.setAttribute('markerHeight', '6');
      m.setAttribute('orient', 'auto-start-reverse');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M1.4 1.6 L6 4 L1.4 6.4'); p.setAttribute('fill', 'none');
      p.setAttribute('stroke', col); p.setAttribute('stroke-width', String(sw));
      p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
      m.appendChild(p);
      return m;
    };
    defs.appendChild(mk('ufAh', edgeCol, 1.4));
    defs.appendChild(mk('ufAhh', selCol, 1.8));
    defs.appendChild(mk('ufAha', advCol, 1.4));
    wiresEl.appendChild(defs);
    const pos: Record<string, Box> = {};
    contentEl.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => { pos[el.dataset.id as string] = box(el); });
    interface Agg { a: string; b: string; w: number; adv: boolean }
    const agg = new Map<string, Agg>();
    for (const e of EDGES) {
      if (!((e.call && layers.calls) || (e.dep && layers.deps))) continue;
      const a = visibleRep(e.from), b = visibleRep(e.to);
      if (!a || !b || a === b || !pos[a] || !pos[b]) continue;
      const k = a + ' ' + b;
      if (!agg.has(k)) agg.set(k, { a, b, w: 0, adv: false });
      const s = agg.get(k) as Agg;
      s.w += e.w;
      if (ALLOW.has(e.from + '->' + e.to)) s.adv = true;
    }
    const selRep = SEL ? visibleRep(SEL) : null;
    const blastOn = layers.blast && !!selRep;
    const maxw = Math.max(1, ...[...agg.values()].map((x) => x.w));
    const items = [...agg.values()].sort((x, y) => {
      const hx = selRep && (x.a === selRep || x.b === selRep), hy = selRep && (y.a === selRep || y.b === selRep);
      return (hx ? 1 : 0) - (hy ? 1 : 0);
    });
    requestRoutes(pos, items);
    // a hub's fan-out (the composition root, a config read by everyone) is structure, not story:
    // each of its edges says little, so collectively they recede unless the selection asks for them
    const outDeg = new Map<string, number>();
    for (const it of items) outDeg.set(it.a, (outDeg.get(it.a) ?? 0) + 1);
    for (const it of items) {
      const hot = !!selRep && (it.a === selRep || it.b === selRep);
      const adv = layers.trust && it.adv;
      const inBlast = blastOn && (REP_HOPS.has(it.a) || it.a === selRep) && (REP_HOPS.has(it.b) || it.b === selRep);
      const hub = !hot && (outDeg.get(it.a) ?? 0) > 8;
      // weight ramp: the heavy flows carry the story, the light ones recede instead of stacking into noise
      const t = Math.pow(it.w / maxw, .6) * (hub ? .35 : 1);
      const width = 1 + t * 2.4;
      const p = document.createElementNS(NS, 'path');
      const routed = ROUTES.get(it.a + ' ' + it.b);
      p.setAttribute('d', routed ? polyPath(routed) : wirePath(pos[it.a], pos[it.b]));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', hot ? selCol : adv ? advCol : edgeCol);
      p.setAttribute('stroke-width', String(hot ? Math.max(1.6, width) : width));
      const op = selRep ? (hot ? .95 : inBlast ? .55 : .13) : .18 + .55 * t;
      p.setAttribute('stroke-opacity', String(adv ? Math.max(op, .5) : op));
      p.setAttribute('stroke-linecap', 'round');
      if (adv) p.setAttribute('stroke-dasharray', '4 3');
      p.setAttribute('marker-end', hot ? 'url(#ufAhh)' : adv ? 'url(#ufAha)' : 'url(#ufAh)');
      if (hot) p.classList.add('uf-hot');   // flow animation: the selection's wires visibly carry traffic
      const key = it.a + ' ' + it.b;
      if (!wiresEverDrawn.has(key)) {
        wiresEverDrawn.add(key);
        if (!hot && !adv) {                 // new wires draw themselves in after their cards land
          p.setAttribute('pathLength', '1');
          p.classList.add('uf-enter');
          p.style.animationDelay = Math.max(0, wireEnterAt - performance.now()) + 'ms';
        }
      }
      wiresEl.appendChild(p);
    }
  }

  /* ================= STAGE + FOCUS (approved v3 "stage" design) =================
     Canvas coordinates stay the single spatial truth; stage mode is a SECOND
     PROJECTION of the same graph. Proxy directions derive from group centroids
     in ctx.state positions — the human's manual layout is the source of angles. */
  let STAGE: string | null = null;        // staged container id (spec.stage)
  let FOCUS_TYPE: string | null = null;   // spec.focusType
  let prevShown = new Set<string>();      // entrance-stagger diffing
  let wireEnterAt = 0;                    // wires draw in only after cards land
  let wiresEverDrawn = new Set<string>();

  const stageLayer = h('div', 'uf-stagelayer');
  stageLayer.innerHTML = '<svg class="uf-swires" xmlns="http://www.w3.org/2000/svg"></svg>';
  stageEl.appendChild(stageLayer);
  const sWiresEl = stageLayer.querySelector('.uf-swires') as unknown as SVGSVGElement;

  /** the staged container plus every ancestor above it (the stage's frame set) */
  function stageFrameIds(): Set<string> {
    const s = new Set<string>();
    if (!STAGE) return s;
    s.add(STAGE);
    let u = U.get(STAGE);
    const seen = new Set<string>();
    while (u && u.parent && !seen.has(u.id)) { seen.add(u.id); s.add(u.parent); u = U.get(u.parent); }
    return s;
  }
  /** aggregation target for a proxy pill: the COARSEST ancestor of `outside`
      that does not contain the staged subtree — a sibling in the same group
      stays itself; a foreign subtree compresses into its top group */
  function proxyTargetOf(outside: string, frame: Set<string>): string {
    let u = U.get(outside);
    const seen = new Set<string>();
    const chain: string[] = [];
    while (u && !seen.has(u.id)) { seen.add(u.id); chain.push(u.id); u = u.parent ? U.get(u.parent) : undefined; }
    for (let i = chain.length - 1; i >= 0; i--) if (!frame.has(chain[i])) return chain[i];
    return outside;
  }
  /** ancestor-or-self that is a DIRECT child of the staged container; null when outside it */
  function stageRepOf(id: string): string | null {
    let u = U.get(id);
    const seen = new Set<string>();
    while (u && !seen.has(u.id)) {
      seen.add(u.id);
      if (u.id === STAGE) return null;
      if (u.parent === STAGE) return u.id;
      u = u.parent ? U.get(u.parent) : undefined;
    }
    return null;
  }
  /** mean center of a container subtree in ctx.state world coordinates */
  function centroidOf(rid: string): { x: number; y: number } {
    let sx = 0, sy = 0, n = 0;
    (function walk(id: string): void {
      const nd = ctx.state.nodes[id];
      if (nd) { sx += nd.x + nd.w / 2; sy += nd.y + nd.h / 2; n++; }
      (U.get(id)?.children ?? []).forEach(walk);
    })(rid);
    return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
  }
  const baseType = (s: string): string => {
    const i = s.indexOf(':');
    return (i >= 0 ? s.slice(i + 1) : s).trim().replace(/\[\]$/, '');
  };
  function carriesType(id: string, t: string): boolean {
    const u = U.get(id);
    if (!u) return false;
    return [...u.accepts, ...u.returns, ...u.state].some((x) => baseType(x) === t);
  }

  /** staggered fade-up entrance for newly-revealed cards; wires draw in after cards land */
  function enterStagger(): void {
    const els: HTMLElement[] = [];
    contentEl.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => {
      if (!prevShown.has(el.dataset.id as string)) els.push(el);
    });
    els.forEach((el) => el.classList.add('uf-born'));
    els.forEach((el, i) => setTimeout(() => el.classList.add('uf-in'), 80 + i * 55));
    const done = 80 + els.length * 55 + 650;
    if (els.length) setTimeout(() => els.forEach((el) => el.classList.remove('uf-born', 'uf-in')), done + 60);
    wireEnterAt = els.length ? performance.now() + 80 + els.length * 55 + 250 : wireEnterAt;
    prevShown = new Set([...contentEl.querySelectorAll<HTMLElement>('.uf-card')].map((el) => el.dataset.id as string));
  }

  /** focus illumination: selection glows, 1-hop neighbours lit, its wires flow, rest dims — no rebuild */
  function focusDim(): void {
    const blastOn = layers.blast && !!SEL;
    overlay.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => {
      const id = el.dataset.id as string;
      const sel = SEL === id;
      const lit = !!FOCUS_TYPE && carriesType(id, FOCUS_TYPE);
      el.classList.toggle('sel', sel);
      el.classList.toggle('lit', lit);
      if (!blastOn) {
        const nbr = !FOCUS_TYPE && !!SEL && !sel && isNeighbour(SEL, id);
        const dim = FOCUS_TYPE ? !lit : (SEL ? !sel && !nbr : false);
        el.classList.toggle('nbr', nbr);
        el.classList.toggle('dim', dim);
      }
    });
    overlay.querySelectorAll<HTMLElement>('.uf-t').forEach((s) =>
      s.classList.toggle('hit', s.dataset.t === FOCUS_TYPE));
  }

  /** animated reframe: the world transform-scales so all visible content fits (~.9s expo) */
  function reframeToFit(): void {
    worldEl.classList.remove('anim');
    worldEl.classList.add('anim2');
    const { w, h: hh } = contentSize(), sw = stageEl.clientWidth, sh = stageEl.clientHeight, pad = 64;
    Z.k = Math.max(.15, Math.min(1.15, Math.min((sw - pad * 2) / w, (sh - pad * 2) / hh)));
    Z.x = (sw - w * Z.k) / 2;
    Z.y = Math.max(pad, (sh - hh * Z.k) / 2);
    worldEl.style.transform = `translate(${Z.x}px,${Z.y}px) scale(${Z.k})`;
    setTimeout(() => worldEl.classList.remove('anim2'), 950);
  }

  /** type focus: every carrier module lights across the surface; inspector lists carriers */
  function typeFocus(t: string | null): void {
    FOCUS_TYPE = t;
    if (t) SEL = null;
    focusDim();
    renderInspector();
    setTimeout(STAGE ? drawStageWires : drawWires, 0);
  }
  overlay.addEventListener('click', (e) => {
    const tk = (e.target as HTMLElement).closest('.uf-t') as HTMLElement | null;
    if (!tk) return;
    e.stopPropagation();
    typeFocus(FOCUS_TYPE === tk.dataset.t ? null : (tk.dataset.t as string));
  }, true);

  /** stage projection: focused group center-stage; explore world blurred behind. Exit restores explore exactly. */
  function stageMode(gid: string | null): void {
    STAGE = gid && U.has(gid) ? gid : null;
    overlay.classList.toggle('staged', !!STAGE);
    renderStageGroup(undefined);
    focusDim();
  }
  function renderStageGroup(dirFrom?: number): void {
    stageLayer.querySelectorAll('.uf-sgroup,.uf-proxy').forEach((x) => x.remove());
    sWiresEl.innerHTML = '';
    if (!STAGE) return;
    const u = gu(STAGE);
    const crumbs: string[] = [];
    let x: UNode | undefined = u;
    const seen = new Set<string>();
    while (x && x.parent && !seen.has(x.id)) { seen.add(x.id); x = U.get(x.parent); if (x) crumbs.unshift(x.label); }
    const g = h('div', 'uf-sgroup',
      `<div class="uf-shead"><span class="uf-slabel">${esc(u.label)}</span>
        <span class="uf-strail">${esc(crumbs.join(' / '))}</span>
        <button class="uf-sleave">← explore</button></div>`);
    const wrap = h('div', 'uf-sbody');
    for (const c of u.children) if (!hidden.has(c)) wrap.appendChild(cardEl(gu(c)));
    g.appendChild(wrap);
    (g.querySelector('.uf-sleave') as HTMLElement).onclick = () => {
      SEL = null; FOCUS_TYPE = null; stageMode(null); renderInspector(); setTimeout(drawWires, 0);
    };
    if (dirFrom !== undefined) {
      g.style.transition = 'none';
      g.style.transform =
        `translate(calc(-50% + ${Math.round(Math.cos(dirFrom) * 70)}px),calc(-50% + ${Math.round(Math.sin(dirFrom) * 70)}px)) scale(.94)`;
      setTimeout(() => { g.style.transition = ''; g.style.transform = ''; }, 30);
    }
    stageLayer.appendChild(g);
    stageProxies();
    setTimeout(drawStageWires, 60);
  }

  /** directional proxy pills: external edges aggregate per target container; angle = true angle between centroids.
      Edge-granularity honesty: cross-module edges in this model attach at MODULE level, so an edge incident to the
      staged container itself or its ancestor chain is FRAME-attributed (no child anchor) — without that a staged
      sub-group shows no connections at all. Child-attributed links obey the selection filter; frame links persist. */
  function stageProxies(): void {
    stageLayer.querySelectorAll('.uf-proxy').forEach((p) => p.remove());
    if (!STAGE) return;
    const selStaged = SEL ? stageRepOf(SEL) : null;
    const frameIds = stageFrameIds();
    interface PLink { inside: string | null; outside: string }
    const byRoot = new Map<string, PLink[]>();
    for (const e of EDGES) {
      const ra = stageRepOf(e.from), rb = stageRepOf(e.to);
      let inside: string | null = null, outside: string | null = null;
      if ((ra || frameIds.has(e.from)) && !rb && !frameIds.has(e.to)) { inside = ra; outside = e.to; }
      else if ((rb || frameIds.has(e.to)) && !ra && !frameIds.has(e.from)) { inside = rb; outside = e.from; }
      else continue;
      if (selStaged && inside !== null && inside !== selStaged) continue;
      if (stageRepOf(outside)) continue; // inside the staged subtree after all
      const og = proxyTargetOf(outside, frameIds);
      if (!byRoot.has(og)) byRoot.set(og, []);
      (byRoot.get(og) as PLink[]).push({ inside, outside });
    }
    const cx = stageEl.clientWidth / 2, cy = stageEl.clientHeight / 2;
    const R = Math.min(stageEl.clientWidth, stageEl.clientHeight) * .40;
    const a = centroidOf(STAGE);
    const entries = [...byRoot.entries()].map(([og, links]) => {
      const b = centroidOf(og);
      return { og, links, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }).sort((x, y) => x.ang - y.ang);
    // de-overlap: a near-1-D editor layout clusters the true angles; spread pills apart
    // while preserving the true angular ORDER (the spatial meaning the human laid out)
    const minSep = Math.min(.55, (Math.PI * 2) / Math.max(entries.length, 1));
    for (let pass = 0; pass < 24 && entries.length > 1; pass++) {
      let moved = false;
      for (let j = 0; j < entries.length; j++) {
        const p1 = entries[j], p2 = entries[(j + 1) % entries.length];
        let d = p2.ang - p1.ang;
        if (j === entries.length - 1) d += Math.PI * 2;
        if (d < minSep - 1e-4) { const push = (minSep - d) / 2; p1.ang -= push; p2.ang += push; moved = true; }
      }
      if (!moved) break;
    }
    let i = 0;
    for (const { og, links, ang } of entries) {
      const p = h('div', 'uf-proxy');
      p.dataset.gid = og;
      p.dataset.ang = String(ang);
      if (links.some((l) => l.inside === null)) p.dataset.frame = '1';
      const gl = gu(og).label;
      const names = [...new Set(links.map((l) => U.get(l.outside)?.label ?? l.outside))].filter((n) => n !== gl);
      p.innerHTML = `<span class="uf-pdot"></span>${names.length ? `<span>${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ' +' + (names.length - 3) : ''}</span>` : ''}
        <span class="uf-pgrp">${esc(gl)}</span>`;
      p.style.left = (cx + Math.cos(ang) * R * 1.05) + 'px';
      p.style.top = (cy + Math.sin(ang) * R * .9) + 'px';
      p.style.transitionDelay = (120 + i * 70) + 'ms';
      p.onclick = (e) => { e.stopPropagation(); peekProxy(p, og, links.map((l) => l.outside), ang); };
      stageLayer.appendChild(p);
      i++;
    }
  }

  /** peek → travel: proxy expands in place; explicit travel swaps the target group onto stage from its direction */
  function peekProxy(p: HTMLElement, og: string, outs: string[], ang: number): void {
    if (p.classList.contains('peek')) return;
    stageLayer.querySelectorAll('.uf-proxy.peek').forEach((q2) => { q2.remove(); });
    p.classList.add('peek');
    p.style.transitionDelay = '0ms';
    const uniq = [...new Set(outs)];
    const ogu = gu(og);
    const members = uniq.filter((m) => m !== og);
    const body = members.length
      ? members.slice(0, 4).map((m) => {
          const um = U.get(m);
          return `<div class="uf-pdesc"><b>${esc(um?.label ?? m)}</b>${um?.desc ? ' — ' + esc(um.desc) : ''}</div>`;
        }).join('')
      : `<div class="uf-pdesc">${ogu.desc ? esc(ogu.desc) : `${ogu.children.length} inside · fan-in ${ogu.fanIn}`}</div>`;
    p.innerHTML = `<span class="uf-ptitle">${esc(ogu.label)}</span>${body}<button class="uf-ptravel">travel →</button>`;
    (p.querySelector('.uf-ptravel') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      SEL = uniq[0] && gu(og).children.includes(uniq[0]) ? uniq[0] : null;
      stageTravel(og, ang);
    };
    p.onclick = (e) => { e.stopPropagation(); p.remove(); stageProxies(); setTimeout(drawStageWires, 0); };
  }
  function stageTravel(target: string, fromAngle: number): void {
    if (!U.has(target)) return;
    if (!gu(target).children.length) {
      // a childless module has nothing to project — land in explore with it selected
      SEL = target; FOCUS_TYPE = null; stageMode(null); revealNode(target); render(true);
      return;
    }
    STAGE = target;
    overlay.classList.add('staged');
    renderStageGroup(fromAngle + Math.PI);
    focusDim();
    renderTree();
    renderInspector();
  }

  /** stage wires: intra-stage curves between staged cards + curved wires to proxy pills; selection carries the flow */
  function drawStageWires(): void {
    sWiresEl.innerHTML = '';
    if (!STAGE) return;
    const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
    sWiresEl.setAttribute('viewBox', `0 0 ${sw} ${sh}`);
    const sr = stageEl.getBoundingClientRect();
    const pos: Record<string, DOMRect> = {};
    stageLayer.querySelectorAll<HTMLElement>('.uf-sgroup .uf-card').forEach((el) => {
      pos[el.dataset.id as string] = el.getBoundingClientRect();
    });
    const edgeCol = cvar('--uf-dim') || '#948f84', selCol = cvar('--uf-accent') || '#4a6b8a';
    const mkPath = (d: string, hot: boolean): SVGPathElement => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', hot ? selCol : edgeCol);
      p.setAttribute('stroke-width', hot ? '1.8' : '1.2');
      p.setAttribute('stroke-opacity', hot ? '.95' : '.5');
      p.setAttribute('stroke-linecap', 'round');
      if (hot) p.classList.add('uf-hot');
      return p;
    };
    const rel = (r: DOMRect): { x: number; y: number } => ({ x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2 });
    const repIn = (id: string): string | null => { const r = stageRepOf(id); return r && pos[r] ? r : null; };
    const seenK = new Set<string>();
    for (const e of EDGES) {
      const a = repIn(e.from), b = repIn(e.to);
      if (!a || !b || a === b) continue;
      const k = a + ' ' + b;
      if (seenK.has(k)) continue;
      seenK.add(k);
      const pa = rel(pos[a]), pb = rel(pos[b]);
      const hot = !!SEL && (a === SEL || b === SEL);
      sWiresEl.appendChild(mkPath(`M ${pa.x} ${pa.y} C ${(pa.x + pb.x) / 2} ${pa.y} ${(pa.x + pb.x) / 2} ${pb.y} ${pb.x} ${pb.y}`, hot));
    }
    const frame = stageFrameIds();
    stageLayer.querySelectorAll<HTMLElement>('.uf-proxy').forEach((px) => {
      const og = px.dataset.gid as string, pr = px.getBoundingClientRect();
      const bx = pr.left - sr.left + pr.width / 2, by = pr.top - sr.top + pr.height / 2;
      const linked = new Set<string>();
      for (const e of EDGES) {
        const ra = repIn(e.from), rb = repIn(e.to);
        let s: string | null = null;
        if (ra && !rb && proxyTargetOf(e.to, frame) === og) s = ra;
        else if (rb && !ra && proxyTargetOf(e.from, frame) === og) s = rb;
        if (!s || linked.has(s)) continue;
        if (SEL && stageRepOf(SEL) && s !== SEL) continue;
        linked.add(s);
        const pa = rel(pos[s]);
        const mx = (pa.x + bx) / 2, my = (pa.y + by) / 2;
        sWiresEl.appendChild(mkPath(`M ${pa.x} ${pa.y} Q ${mx} ${pa.y} ${mx} ${my} T ${bx} ${by}`, !!SEL && s === SEL));
      }
      // frame-attributed pill with no child anchor: wire from the stage-group frame edge toward the pill
      if (!linked.size && px.dataset.frame) {
        const gEl = stageLayer.querySelector('.uf-sgroup');
        if (gEl) {
          const gr = gEl.getBoundingClientRect();
          const ga = { x: gr.left - sr.left + gr.width / 2, y: gr.top - sr.top + gr.height / 2 };
          const fang = Math.atan2(by - ga.y, bx - ga.x);
          const fx = ga.x + Math.cos(fang) * (gr.width / 2), fy = ga.y + Math.sin(fang) * (gr.height / 2);
          const mx = (fx + bx) / 2, my = (fy + by) / 2;
          sWiresEl.appendChild(mkPath(`M ${fx} ${fy} Q ${mx} ${fy} ${mx} ${my} T ${bx} ${by}`, false));
        }
      }
    });
  }

  /* ================= WRITE-THROUGH (never a private write path) ================= */
  const fmEditor = initInspectorFrontmatter(ctx);
  let FM_OPEN = false;

  /** inline rename on the selected card (Enter / double-click on selected), writing
      through the existing model path — mutate ctx.state, then hooks render + sync +
      pushHistory + persist. Never a private write path. */
  function renameInPlace(id: string): void {
    const n = ctx.state.nodes[id];
    const scope: HTMLElement = STAGE ? stageLayer : contentEl;
    const name = scope.querySelector<HTMLElement>(`.uf-card[data-id="${window.CSS.escape(id)}"] .uf-cname`);
    if (!n || !name || name.isContentEditable) return;
    const u = gu(id);
    const prev = u.label;
    name.setAttribute('contenteditable', 'true');
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sl = window.getSelection();
    sl?.removeAllRanges();
    sl?.addRange(range);
    let settled = false;
    const finish = (commit: boolean): void => {
      if (settled) return;
      settled = true;
      name.removeAttribute('contenteditable');
      const v = (name.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!commit || !v || v === prev) { name.textContent = prev; return; }
      if (n.fm?.name) n.fm.name = v; else n.label = v;
      u.label = v;
      ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory(); ctx.hooks.persist();
      if (STAGE) { renderStageGroup(undefined); focusDim(); renderTree(); renderInspector(); }
      else render(false);
    };
    name.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    name.onblur = () => finish(true);
  }

  /** mount the app's frontmatter editor (panel/inspector-frontmatter) for the selected
      node inside the reading inspector — the same hooks write path as renameInPlace;
      committed edits re-derive the folded view from ctx.state. */
  function mountFrontmatter(host: HTMLElement, id: string): void {
    const n = ctx.state.nodes[id];
    if (!n) return;
    fmEditor.renderFrontmatterSection(host, n);
    host.addEventListener('change', () => {
      build();
      computeBlast();
      renderCanvas();
      focusDim();
      renderTree();
      setTimeout(STAGE ? drawStageWires : drawWires, 0);
    });
  }

  /* ================= ORCHESTRATION ================= */
  let firstFit = true;
  function render(refit: boolean): void {
    computeBlast();
    renderCanvas();
    enterStagger();
    focusDim();
    renderTree();
    renderInspector();
    const shown = [...U.keys()].filter((id) => isRendered(id)).length - ROOTS.filter((r) => isRendered(r)).length;
    const total = U.size - ROOTS.length;
    q('ufCount').textContent = shown + ' shown';
    q('ufHint').innerHTML = shown === 0 || total <= 0 ? ''
      : `<b>${Math.round((1 - shown / total) * 100)}%</b> still folded · ${shown} of ${total} shown`;
    persistView('save'); // every view mutation lands here — a reload mid-session loses nothing
    // plain timers, never rAF: rAF freezes in occluded windows and the redraw silently stalls
    setTimeout(() => {
      if (refit) { if (firstFit) fitView(false); else reframeToFit(); }
      firstFit = false;
      drawWires();
      const settle = Math.max(refit ? 960 : 80, wireEnterAt - performance.now() + 950);
      setTimeout(drawWires, settle);
    }, 0);
  }
  function toggleExpand(id: string): void {
    if (!isContainer(U.get(id))) return;
    if (expanded.has(id)) {
      expanded.delete(id);
      (function fold(x: string): void { gu(x).children.forEach((c) => { expanded.delete(c); fold(c); }); })(id);
    } else expanded.add(id);
    render(true);
  }
  function select(id: string): void {
    SEL = SEL === id ? null : id;
    FOCUS_TYPE = null;
    FM_OPEN = false;
    if (STAGE) {
      // re-aggregate proxies around the new selection; no rebuild
      stageProxies();
      focusDim();
      renderTree();
      renderInspector();
      setTimeout(drawStageWires, 0);
      return;
    }
    if (layers.blast) { render(false); return; }
    focusDim();
    renderTree();
    renderInspector();
    setTimeout(drawWires, 0);
    // approved stage entry: selecting a card projects its GROUP center-stage;
    // a top-level container card (a module) IS the group — project it directly
    const u = SEL ? U.get(SEL) : undefined;
    if (u && u.parent && isContainer(U.get(u.parent))) stageMode(u.parent);
    else if (u && !u.parent && isContainer(u)) stageMode(u.id);
  }
  function foldAll(): void {
    expanded.clear(); hidden.clear(); SEL = null; QUERY = ''; FOCUS_TYPE = null;
    if (STAGE) stageMode(null);
    (q('ufSearch') as HTMLInputElement).value = '';
    render(true);
  }

  /* ================= TREE ================= */
  function renderTree(): void {
    const t = q('ufTree');
    t.innerHTML = '';
    for (const rid of ROOTS) t.appendChild(treeRow(rid));
    if (QUERY) filterTree();
  }
  function treeRow(id: string): HTMLElement {
    const u = gu(id), wrap = h('div');
    const canOpen = isContainer(u), on = isRendered(id) && !hidden.has(id), open = expanded.has(id);
    const row = h('div', 'uf-trow ' + (canOpen ? '' : 'leaf ') + (on ? 'on ' : '') + (open ? 'open ' : '') + (SEL === id ? 'sel' : ''));
    row.dataset.id = id;
    row.innerHTML = `<span class="uf-ttw">${canOpen ? '<svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg>' : ''}</span>
      <span class="uf-tlabel">${esc(u.label)}</span>
      <span class="uf-tchk" title="Show / hide on canvas"></span>`;
    (row.querySelector('.uf-ttw') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      if (!canOpen) return;
      revealNode(id);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      render(true);
    };
    (row.querySelector('.uf-tchk') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      if (isRendered(id) && !hidden.has(id)) {
        if (ROOTS.includes(id) && ROOTS.filter((r) => !hidden.has(r)).length <= 1) return;
        hidden.add(id);
        if (SEL === id) SEL = null;
      } else revealNode(id);
      render(true);
    };
    (row.querySelector('.uf-tlabel') as HTMLElement).onclick = (e) => {
      e.stopPropagation(); revealNode(id); SEL = id; render(true);
    };
    wrap.appendChild(row);
    if (canOpen) {
      const kids = h('div', 'uf-tkids' + (open ? ' open' : ''));
      for (const c of u.children) kids.appendChild(treeRow(c));
      wrap.appendChild(kids);
    }
    return wrap;
  }
  function filterTree(): void {
    const hits = new Set<string>();
    for (const u of U.values()) {
      if (u.label.toLowerCase().includes(QUERY) || u.desc.toLowerCase().includes(QUERY)) {
        let x: UNode | undefined = u;
        const seen = new Set<string>();
        while (x && !seen.has(x.id)) { seen.add(x.id); hits.add(x.id); x = x.parent ? U.get(x.parent) : undefined; }
      }
    }
    q('ufTree').querySelectorAll<HTMLElement>('.uf-trow').forEach((r) => {
      const id = r.dataset.id as string;
      const kb = r.parentElement?.querySelector(':scope > .uf-tkids') as HTMLElement | null;
      if (kb) { const show = hits.has(id); kb.classList.toggle('open', show); r.classList.toggle('open', show); }
      r.style.display = hits.size ? (hits.has(id) ? '' : 'none') : '';
    });
  }

  /* ================= INSPECTOR (empty until selection) ================= */
  function renderInspector(): void {
    const el = q('ufInsp');
    if (FOCUS_TYPE) {
      const t = FOCUS_TYPE;
      const carriers = [...U.keys()].filter((id) => carriesType(id, t));
      el.innerHTML = `<div class="uf-ihead">
        <span class="uf-ikind">type</span>
        <div class="uf-iname uf-mono">${esc(t)}</div>
      </div>
      <div class="uf-blk"><div class="uf-ilab2">carried by (${carriers.length})</div>
      ${carriers.map((id) =>
        `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">·</span><span class="uf-cn">${esc(U.get(id)?.label ?? id)}</span></div>`).join('')}
      </div>`;
      el.querySelectorAll<HTMLElement>('[data-goto]').forEach((r) => {
        r.onclick = () => {
          const id = r.dataset.goto as string;
          FOCUS_TYPE = null;
          revealNode(id);
          SEL = id;
          render(true);
        };
      });
      return;
    }
    if (!SEL || !U.has(SEL)) { el.innerHTML = ''; return; }
    const u = gu(SEL);
    const isSym = SYM_KINDS.has(u.kind);
    const canOpen = isContainer(u);
    const crumbs: string[] = [];
    let x: UNode | undefined = u;
    const seen = new Set<string>();
    while (x && x.parent && !seen.has(x.id)) { seen.add(x.id); x = U.get(x.parent); if (x) crumbs.unshift(x.label); }
    let html = `<div class="uf-ihead">
      <span class="uf-ikind">${esc(u.kind)}</span>
      <div class="uf-iname${isSym ? ' uf-mono' : ''}">${esc(u.label)}</div>
      ${crumbs.length ? `<div class="uf-ipath">${esc(crumbs.join('  ›  '))}</div>` : ''}
      ${u.desc ? `<div class="uf-idesc">${esc(u.desc)}</div>` : ''}
      <div class="uf-iact">
        ${canOpen ? `<button class="uf-ibtn pri" id="ufIOpen">${expanded.has(u.id) ? 'fold' : 'unfold'}</button>` : ''}
        ${isRendered(u.id)
          ? `<button class="uf-ibtn" id="ufIHide">remove from view</button>`
          : `<button class="uf-ibtn" id="ufIShow">add to view</button>`}
        ${ctx.state.nodes[u.id] ? `<button class="uf-ibtn${FM_OPEN ? ' pri' : ''}" id="ufIEdit">${FM_OPEN ? 'done' : 'edit'}</button>` : ''}
      </div>
    </div>
    ${FM_OPEN && ctx.state.nodes[u.id] ? '<div class="uf-blk" id="ufFmHost"></div>' : ''}`;
    const blk = (l: string, a: string[]): string =>
      a.length ? `<div class="uf-blk"><div class="uf-ilab2">${l}</div>${a.map((v) => `<div class="uf-iline">${ifaceLine(v)}</div>`).join('')}</div>` : '';
    html += blk('accepts', u.accepts) + blk('returns', u.returns) + blk('state', u.state);
    if (layers.blast) {
      html += `<div class="uf-blk"><div class="uf-ilab2">blast radius</div><div class="uf-iline">${BLAST_N} transitive dependent${BLAST_N === 1 ? '' : 's'}</div></div>`;
    }
    const conns = (arr: UEdge[], key: 'from' | 'to', title: string, arrow: string): string => {
      const m = new Map<string, string>();
      for (const e of arr) if (!m.has(e[key])) m.set(e[key], e.label);
      if (!m.size) return '';
      return `<div class="uf-blk"><div class="uf-ilab2">${title} (${m.size})</div>`
        + [...m.entries()].map(([id, lbl]) => {
          const adv = layers.trust && ALLOW.has(key === 'to' ? u.id + '->' + id : id + '->' + u.id);
          const chip = adv ? '<span class="uf-cl adv">advisory</span>'
            : lbl ? `<span class="uf-cl">${esc(lbl.split(',')[0])}</span>` : '';
          return `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${arrow}</span><span class="uf-cn">${esc(U.get(id)?.label ?? id)}</span>${chip}</div>`;
        }).join('')
        + '</div>';
    };
    html += conns(OUT[u.id] ?? [], 'to', 'uses →', '→') + conns(IN[u.id] ?? [], 'from', '← used by', '←');
    const body = (ctx.bodies?.get(u.id) as { body?: string } | undefined)?.body;
    if (body) html += `<div class="uf-blk"><div class="uf-ilab2">source</div><div class="uf-body"><pre>${esc(body)}</pre></div></div>`;
    el.innerHTML = html;
    const io = el.querySelector('#ufIOpen') as HTMLElement | null;
    if (io) io.onclick = () => toggleExpand(u.id);
    const ie = el.querySelector('#ufIEdit') as HTMLElement | null;
    if (ie) ie.onclick = () => { FM_OPEN = !FM_OPEN; renderInspector(); };
    const fmHost = el.querySelector('#ufFmHost') as HTMLElement | null;
    if (fmHost) mountFrontmatter(fmHost, u.id);
    const ih = el.querySelector('#ufIHide') as HTMLElement | null;
    if (ih) ih.onclick = () => { hidden.add(u.id); SEL = null; render(true); };
    const is2 = el.querySelector('#ufIShow') as HTMLElement | null;
    if (is2) is2.onclick = () => { revealNode(u.id); render(true); };
    el.querySelectorAll<HTMLElement>('[data-goto]').forEach((r) => {
      r.onclick = () => { const id = r.dataset.goto as string; revealNode(id); SEL = id; render(true); };
    });
  }

  /* ================= LAYERS ================= */
  function renderLayers(): void {
    const bx = q('ufLayers');
    bx.innerHTML = '';
    for (const L of LAYER_DEFS) {
      const noSrc = L.k === 'trust' && !TRUST_SRC;
      const row = h('div', 'uf-layer' + (layers[L.k] ? ' on' : '') + (noSrc ? ' off' : ''),
        `<span class="uf-sw"></span><span style="flex:1;min-width:0"><div class="uf-lt">${L.t}</div><div class="uf-ld">${L.d}</div></span>`
        + (noSrc ? '<button class="uf-load" title="Load an edge-advisory-allowlist.txt">load…</button>' : ''));
      if (noSrc) {
        // no advisory source = the layer stays off (it never marks what it cannot back)
        row.onclick = (e) => {
          if ((e.target as HTMLElement).closest('.uf-load')) { e.stopPropagation(); trustFileEl.click(); }
        };
      } else {
        row.onclick = () => { layers[L.k] = !layers[L.k]; applyLayerClasses(); renderLayers(); render(false); };
      }
      bx.appendChild(row);
    }
  }
  function applyLayerClasses(): void {
    overlay.classList.toggle('desc', layers.desc);
    overlay.classList.toggle('iface', layers.iface);
    overlay.classList.toggle('metrics', layers.metrics);
    overlay.classList.toggle('color', layers.color);
    overlay.classList.toggle('trust', layers.trust);
  }

  /* ================= CHROME-LESS CONTROLS ================= */
  q('ufZin').onclick = () => { Z.k = Math.min(2.5, Z.k * 1.15); clampPan(); setT(true); };
  q('ufZout').onclick = () => { Z.k = Math.max(.15, Z.k / 1.15); clampPan(); setT(true); };
  q('ufZfit').onclick = () => fitView(true);
  q('ufFold').onclick = foldAll;
  function applyDark(dark: boolean): void {
    overlay.classList.toggle('dark', dark);
    q('ufThemeIc').innerHTML = dark
      ? '<circle cx="8" cy="8" r="3.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"/>'
      : '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z"/>';
    localStorage.setItem('unfold.theme', dark ? 'dark' : 'light');
    drawWires();
  }
  q('ufTheme').onclick = () => applyDark(!overlay.classList.contains('dark'));
  (q('ufSearch') as HTMLInputElement).oninput = (e) => {
    QUERY = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderTree();
  };
  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('show')) return;
    const t = e.target as HTMLElement;
    const inAnyField = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (e.key === 'Enter') {
      // rename the selected card in place — but never while typing in a field
      if (!inAnyField && SEL && !FOCUS_TYPE) { e.stopPropagation(); renameInPlace(SEL); }
      return;
    }
    if (e.key !== 'Escape') return;
    // a rename in flight or a frontmatter field owns its own Escape; the search box keeps the old chain
    if (t.isContentEditable || (inAnyField && t.id !== 'ufSearch')) return;
    e.stopPropagation();
    if (FOCUS_TYPE) { typeFocus(null); }
    else if (STAGE) { SEL = null; stageMode(null); renderInspector(); setTimeout(drawWires, 0); }
    else if (SEL) { SEL = null; render(false); }
    else if (QUERY) { QUERY = ''; (q('ufSearch') as HTMLInputElement).value = ''; renderTree(); }
    else close();
  }, true);

  /* ================= API ================= */
  trustLayer();
  function open(): void {
    applyDark(localStorage.getItem('unfold.theme') === 'dark');
    build();
    persistView('load');
    selectSync('open');
    prevShown = new Set();
    wiresEverDrawn = new Set();
    wireEnterAt = 0;
    FOCUS_TYPE = null;
    FM_OPEN = false;
    if (STAGE) stageMode(null);
    applyLayerClasses();
    renderLayers();
    overlay.classList.add('show');
    firstFit = true;
    render(true);
  }
  function close(): void {
    if (!overlay.classList.contains('show')) return;
    persistView('save');
    selectSync('close');
    overlay.classList.remove('show');
  }
  const closeFn = close;
  // ✕ closes the topmost surface: a staged window exits to explore; explore exits to the editor
  q('ufClose').onclick = () => {
    if (STAGE) { SEL = null; FOCUS_TYPE = null; stageMode(null); renderInspector(); setTimeout(drawWires, 0); return; }
    closeFn();
  };
  return {
    open,
    close: closeFn,
    toggle: () => (overlay.classList.contains('show') ? closeFn() : open()),
  };
}
