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
import type { DiagramNode, NodeKind, Point } from '../core/types/types';
import type { SelectionApi } from '../interaction/selection';
import type { CameraApi } from '../core/camera/camera';
import { esc, FONT_ORDER, FONTS, KINDS } from '../core/config/config';
import { portPos, bestSides } from '../core/state/state';
import { emptyViewSpec, normalizeViewSpec, reduceView } from '../core/viewspec/viewspec';
import type { ViewSpec, ViewAction, ViewModelIndex } from '../core/viewspec/viewspec';
import { orthoPath as elbowPath, polyPath } from '../render/wires';
import { routeGraph } from '../render/avoidRouter';
import type { AdhocRect, AdhocEdge } from '../render/avoidRouter';
import { initInspectorFrontmatter } from './inspector-frontmatter';
import { ufEscAction } from './unfold-esc';
import { ufLiftWires } from './unfold-lift';
import type { LiftedWire } from './unfold-lift';
import { ufDockReduce, UF_DOCK_WIDTH } from './unfold-dock';
import type { DockState, DockAction } from './unfold-dock';
import { ufSliceTargets } from './unfold-slice';
import { ufVerbAllowed } from './unfold-verbs';
import type { FilesApi } from '../io/files';
import type { MermaidApi } from '../io/mermaid';
import type { SliceApi } from './slice';
import type { ThemingApi } from './theming';
import type { NodesApi } from '../interaction/nodes';
import type { ClipboardApi } from '../interaction/clipboard';
import type { HistoryApi } from '../core/history/history';

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
  font:14px/1.55 var(--uf-font, Inter,-apple-system,BlinkMacSystemFont,ui-sans-serif,system-ui);
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

.uf-stage{position:relative;flex:1;overflow:hidden;cursor:grab;background:var(--uf-stage);
  user-select:none;-webkit-user-select:none}
.uf-stage.grab{cursor:grabbing}
.uf-world{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
.uf-world.anim{transition:transform .7s cubic-bezier(.16,1,.3,1)}
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
.uf-dock .uf-legacy{width:auto;padding:0 10px;font-size:11px;letter-spacing:.4px;color:var(--uf-faint)}
.uf-hint{position:absolute;left:0;right:0;bottom:16px;text-align:center;z-index:15;pointer-events:none;
  color:var(--uf-faint);font-size:12px}
.uf-hint b{color:var(--uf-dim);font-weight:500}

.uf-grp{border:1px solid var(--uf-line);border-radius:12px;background:var(--uf-surface2);padding:13px;flex:none}
.uf-grp>.uf-ghead{display:flex;align-items:center;gap:9px;padding:2px 4px 11px;cursor:pointer;user-select:none}
.uf-grp>.uf-ghead .uf-tw{width:15px;height:15px;flex:none;display:flex;align-items:center;justify-content:center;
  color:var(--uf-faint);transition:transform .2s var(--uf-ease)}
.uf-grp>.uf-ghead .uf-tw svg{width:9px;height:9px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.uf-grp.open>.uf-ghead .uf-tw{transform:rotate(90deg)}
.uf-grp>.uf-ghead .uf-tw:hover{color:var(--uf-ink)}
.uf-grp.sel{border-color:var(--uf-accent);box-shadow:0 0 0 1px var(--uf-accent)}
.uf-grp.sel>.uf-ghead .uf-gname{color:var(--uf-accent)}
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

.uf-panel{position:relative;width:330px;flex:none;border-left:1px solid var(--uf-line);background:var(--uf-bg);
  display:flex;flex-direction:column;z-index:30}
.uf-panel[hidden],.uf-rail[hidden],.uf-pbody[hidden]{display:none}
.uf-pbody{flex:1;overflow-y:auto;overflow-x:hidden}
.uf-rsz{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:40}
.uf-rsz:hover,.uf-rsz.on{background:linear-gradient(90deg,transparent 2px,var(--uf-accent-line) 2px,var(--uf-accent-line) 4px,transparent 4px)}
.uf-tabs{display:flex;align-items:flex-start;gap:2px;padding:9px 8px 0 12px;border-bottom:1px solid var(--uf-line);flex:none}
.uf-tabrows{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
.uf-tabrow{display:flex;align-items:center;gap:2px;flex-wrap:wrap}
.uf-tab{padding:4px 8px 9px;color:var(--uf-dim);font-size:10.5px;font-weight:600;letter-spacing:.13em;
  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s}
.uf-tab:hover{color:var(--uf-ink)}
.uf-tab.on{color:var(--uf-ink);border-bottom-color:var(--uf-accent)}
.uf-pcol{margin-left:auto;width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  color:var(--uf-faint);border-radius:6px;margin-top:2px}
.uf-pcol:hover{color:var(--uf-ink);background:var(--uf-surface2)}
.uf-pcol svg,.uf-rail svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.uf-rail{width:30px;flex:none;border-left:1px solid var(--uf-line);background:var(--uf-bg);display:flex;
  flex-direction:column;align-items:center;padding-top:10px;z-index:30}
.uf-rail button{width:24px;height:24px;display:flex;align-items:center;justify-content:center;color:var(--uf-faint);border-radius:6px}
.uf-rail button:hover{color:var(--uf-ink);background:var(--uf-surface2)}
.uf-iobtn{display:block;width:100%;text-align:left;padding:8px 10px;margin:0 0 6px;border:1px solid var(--uf-line);
  border-radius:8px;background:var(--uf-surface);color:var(--uf-ink2);font-size:12.5px;transition:border-color .15s,color .15s}
.uf-iobtn:hover{border-color:var(--uf-faint);color:var(--uf-ink)}
.uf-iobtn .uf-ld{display:block;color:var(--uf-faint);font-size:10.5px;margin-top:2px}
.uf-ioinfo{color:var(--uf-faint);font-size:11px;padding:2px 2px 0}
.uf-mmdtext{width:100%;height:46vh;resize:vertical;padding:9px 10px;border:1px solid var(--uf-line);border-radius:8px;
  background:var(--uf-surface);color:var(--uf-ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px;line-height:1.5;white-space:pre;margin:2px 0 8px}
.uf-iorow{display:flex;gap:8px}
.uf-iorow .uf-iobtn{margin:0;text-align:center}
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
.uf-wires path.uf-whit,.uf-swires path.uf-whit{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke;cursor:pointer}
.uf-wires path.uf-whov,.uf-swires path.uf-whov{stroke-opacity:.9}
.uf-wires path.uf-enter,.uf-swires path.uf-enter{stroke-dasharray:1;stroke-dashoffset:1;animation:ufDraw .9s cubic-bezier(.16,1,.3,1) forwards}
@keyframes ufDraw{to{stroke-dashoffset:0}}
.uf-wires path.uf-hot,.uf-swires path.uf-hot{stroke-dasharray:7 9;animation:ufFlow 1.1s linear infinite}
@keyframes ufFlow{to{stroke-dashoffset:-16}}
/* concealed-count badge on an aggregated wire: the aggregate admits what it
   hides; one click opens it (opt-in reveal, never default noise) */
.uf-wires g.uf-wb{cursor:pointer;pointer-events:auto}
.uf-wires g.uf-wb rect{fill:var(--uf-surface);stroke:var(--uf-line)}
.uf-wires g.uf-wb text{fill:var(--uf-dim);font:500 9px ui-monospace,Menlo,monospace}
.uf-wires g.uf-wb:hover rect{stroke:var(--uf-faint)}
.uf-wires g.uf-wb.hot rect{stroke:var(--uf-accent-line)}
.uf-wires g.uf-wb.hot text{fill:var(--uf-accent)}
.uf-wires g.uf-wb.dim{opacity:.18}

/* ---- v3 "stage": type focus ---- */
.uf-t{cursor:pointer;border-bottom:1px dotted var(--uf-faint)}
.uf-t:hover,.uf-t.hit{color:var(--uf-accent);border-bottom-color:var(--uf-accent)}
.uf-card.lit{border-color:var(--uf-accent);box-shadow:0 0 0 1px var(--uf-accent-line)}

/* ---- v3 "stage": stage projection (world blurs behind; group center-stage) ---- */
.uf-world{transition:opacity .7s,filter .7s}
.uf-world.anim{transition:transform .7s cubic-bezier(.16,1,.3,1),opacity .7s,filter .7s}
.uf-world.anim2{transition:transform .9s cubic-bezier(.16,1,.3,1),opacity .7s,filter .7s}
.uf-overlay.staged .uf-world{opacity:.16;filter:blur(5px) saturate(.6);pointer-events:none}
.uf-stagelayer{position:absolute;inset:0;z-index:10;pointer-events:none}
.uf-overlay.staged .uf-stagelayer{pointer-events:auto}
.uf-swires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.uf-sgroup{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);opacity:0;
  transition:opacity .75s cubic-bezier(.16,1,.3,1),transform .75s cubic-bezier(.16,1,.3,1);
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
  opacity:0;transition:opacity .65s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1),border-color .3s,border-radius .35s}
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
  white-space:normal;overflow:visible;text-overflow:clip;min-width:40px;
  user-select:text;-webkit-user-select:text}

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

/* ---- hidden-by-default model verbs: the '⋯' actions menu + connect mode (M5 A-verbs) ---- */
.uf-menu{display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid var(--uf-line);
  border-radius:8px;background:var(--uf-surface)}
.uf-mitem{display:block;width:100%;text-align:left;padding:6px 9px;border-radius:6px;
  color:var(--uf-ink2);font-size:12px;transition:background .12s,color .12s}
.uf-mitem:hover{background:var(--uf-surface2);color:var(--uf-ink)}
.uf-mitem.danger{color:var(--uf-k-class)}
.uf-mrow{display:flex;gap:6px;padding:4px 3px}
.uf-minput{flex:1;min-width:0;border:1px solid var(--uf-line);border-radius:6px;background:var(--uf-surface);
  color:var(--uf-ink);font:inherit;font-size:11.5px;padding:5px 7px}
.uf-msep{border-top:1px solid var(--uf-hair);margin:3px 4px}
.uf-card.uf-armed{border-color:var(--uf-accent);box-shadow:0 0 0 2px var(--uf-accent-line)}
.uf-overlay.uf-connecting .uf-stage,.uf-overlay.uf-connecting .uf-card{cursor:crosshair}
`;

// CSS custom-property names reused across kind lookups and their fallbacks
const K_FUNCTION_VAR = '--uf-k-function';
const K_STORE_VAR = '--uf-k-store';
const K_MODULE_VAR = '--uf-k-module';
const K_CLASS_VAR = '--uf-k-class';
// shared SVG stroke-cap/join value for every wire path (canvas, stage, arrowhead)
const STROKE_ROUND = 'round';
// shared SVG attribute names repeated across every wire/arrowhead path builder
const ATTR_STROKE_WIDTH = 'stroke-width';
const ATTR_STROKE_LINECAP = 'stroke-linecap';

const KIND_VAR: Record<string, string> = {
  type: '--uf-k-type', function: K_FUNCTION_VAR, module: K_MODULE_VAR, group: K_MODULE_VAR,
  store: K_STORE_VAR, class: K_CLASS_VAR, hook: K_FUNCTION_VAR, service: K_STORE_VAR,
  event: K_STORE_VAR, component: K_CLASS_VAR,
};

const LAYER_DEFS: Array<{ k: string; label: string; desc: string }> = [
  { k: 'calls',   label: 'calls',         desc: 'solid call wires' },
  { k: 'deps',    label: 'dependencies',  desc: 'dotted dependency wires' },
  { k: 'desc',    label: 'descriptions',  desc: 'one-line role under each name' },
  { k: 'iface',   label: 'interfaces',    desc: 'accepts / returns on cards' },
  { k: 'metrics', label: 'metrics',       desc: 'child counts · fan-in' },
  { k: 'color',   label: 'colour',        desc: 'tint by kind' },
  { k: 'trust',   label: 'trust',         desc: 'mark advisory claims and edges' },
  { k: 'blast',   label: 'blast radius',  desc: 'ripple what depends on the selection' },
];

// composition root for reading mode: builds the overlay DOM/CSS and wires every module-private helper below into the returned open/close/toggle API
export function initUnfold(ctx: AppContext, deps: { selection: SelectionApi; camera: CameraApi; files: FilesApi; mermaid: MermaidApi; slice: SliceApi; theming: ThemingApi; nodes: NodesApi; clipboard: ClipboardApi; history: HistoryApi }): UnfoldApi {
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
        <button id="ufCompare" class="uf-legacy" title="Compare with the legacy editor — temporary, removed at parity">legacy</button>
      </div>
      <div class="uf-hint" id="ufHint"></div>
    </div>
    <aside class="uf-panel" id="ufPanel">
      <div class="uf-rsz" id="ufRsz" title="Drag to resize"></div>
      <div class="uf-tabs" id="ufTabs">
        <div class="uf-tabrows">
          <div class="uf-tabrow">
            <button class="uf-tab" data-tab="reveal">reveal</button>
            <button class="uf-tab" data-tab="io">io</button>
            <button class="uf-tab" data-tab="mermaid">mermaid</button>
          </div>
          <div class="uf-tabrow">
            <button class="uf-tab" data-tab="slice">slice</button>
            <button class="uf-tab" data-tab="style">style</button>
          </div>
        </div>
        <button class="uf-pcol" id="ufPcol" title="Collapse panel"><svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg></button>
      </div>
      <div class="uf-pbody" id="ufBodyReveal">
        <div class="uf-sec"><div class="uf-secb" id="ufLayers" style="padding-top:12px"></div></div>
        <div class="uf-sec"><div class="uf-sech">browse <span class="uf-n" id="ufCount"></span></div>
          <div class="uf-secb"><input class="uf-search" id="ufSearch" placeholder="find…"><div id="ufTree"></div></div></div>
        <div class="uf-sec"><div class="uf-insp" id="ufInsp"></div></div>
      </div>
      <div class="uf-pbody" id="ufBodyIo" hidden>
        <div class="uf-sec"><div class="uf-sech">diagram</div><div class="uf-secb">
          <button class="uf-iobtn" id="ufSaveMmd">save .mmd<span class="uf-ld">download the current diagram</span></button>
          <button class="uf-iobtn" id="ufLoadMmd">load .mmd…<span class="uf-ld">replace the diagram from a file</span></button>
          <input type="file" id="ufLoadMmdFile" accept=".mmd,.txt" hidden>
        </div></div>
        <div class="uf-sec"><div class="uf-sech">source bodies</div><div class="uf-secb">
          <button class="uf-iobtn" id="ufLoadBodies">load bodies.json…<span class="uf-ld">function bodies for the source pane — read locally, never uploaded</span></button>
          <input type="file" id="ufLoadBodiesFile" accept=".json,application/json" hidden>
          <div class="uf-ioinfo" id="ufBodiesInfo"></div>
        </div></div>
      </div>
      <div class="uf-pbody" id="ufBodyMmd" hidden>
        <div class="uf-sec"><div class="uf-secb" style="padding-top:12px">
          <textarea class="uf-mmdtext" id="ufMmdText" spellcheck="false"></textarea>
          <div class="uf-iorow">
            <button class="uf-iobtn" id="ufMmdApply">apply</button>
            <button class="uf-iobtn" id="ufMmdCopy">copy</button>
          </div>
        </div></div>
      </div>
      <div class="uf-pbody" id="ufBodySlice" hidden>
        <div class="uf-sec"><div class="uf-secb" style="padding-top:12px">
          <div class="uf-ioinfo" id="ufSliceInfo"></div>
          <textarea class="uf-mmdtext" id="ufSliceText" spellcheck="false" readonly></textarea>
          <div class="uf-iorow">
            <button class="uf-iobtn" id="ufSliceCopy">copy</button>
          </div>
        </div></div>
      </div>
      <div class="uf-pbody" id="ufBodyStyle" hidden>
        <div class="uf-sec"><div class="uf-sech">appearance</div><div class="uf-secb">
          <div class="uf-layer" id="ufStyleDark">
            <div class="uf-sw"></div>
            <div><div class="uf-lt">dark mode</div><div class="uf-ld">unfold's light / dark palette</div></div>
          </div>
        </div></div>
        <div class="uf-sec"><div class="uf-sech">font</div><div class="uf-secb">
          <select class="uf-search" id="ufFontSel"></select>
        </div></div>
      </div>
    </aside>
    <div class="uf-rail" id="ufRail" hidden>
      <button id="ufPexp" title="Expand panel"><svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5"/></svg></button>
    </div>`;
  document.body.appendChild(overlay);

  const q = (id: string): HTMLElement => overlay.querySelector('#' + id) as HTMLElement;
  const stageEl = q('ufStage'), worldEl = q('ufWorld'), contentEl = q('ufContent');
  const wiresEl = q('ufWires') as unknown as SVGSVGElement;
  const h = (tag: string, cls?: string, html?: string): HTMLElement => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };

  /* ================= DOCK (P-panel) =================
     The chrome state (tab · collapsed · width) advances ONLY through the
     pure ufDockReduce; this block is a dumb painter of it. Persisted under
     'unfold.dock' — a GLOBAL chrome preference, deliberately not the
     per-diagram ViewSpec (which owns what you look at, not how the panel
     is arranged). */
  const DOCK_TABS = ['reveal', 'io', 'mermaid', 'slice', 'style'];
  const DOCK_KEY = 'unfold.dock';
  const panelEl = q('ufPanel'), railEl = q('ufRail');
  const dockBodies: Record<string, HTMLElement> = {
    reveal: q('ufBodyReveal'), io: q('ufBodyIo'), mermaid: q('ufBodyMmd'),
    slice: q('ufBodySlice'), style: q('ufBodyStyle'),
  };
  const readDock = (): unknown => {
    try { return JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null'); } catch { return null; }
  };
  let dock: DockState = ufDockReduce(
    { tab: DOCK_TABS[0], collapsed: false, width: UF_DOCK_WIDTH },
    { type: 'load', raw: readDock() }, DOCK_TABS);

  function applyDock(reframe: boolean): void {
    panelEl.style.width = dock.width + 'px';
    panelEl.hidden = dock.collapsed;
    railEl.hidden = !dock.collapsed;
    overlay.querySelectorAll('.uf-tab').forEach((tabBtn) =>
      tabBtn.classList.toggle('on', (tabBtn as HTMLElement).dataset.tab === dock.tab));
    for (const tab of DOCK_TABS) dockBodies[tab].hidden = tab !== dock.tab;
    if (dock.tab === 'mermaid' && !dock.collapsed) {
      (q('ufMmdText') as HTMLTextAreaElement).value = deps.mermaid.toMermaid();
    }
    if (dock.tab === 'slice' && !dock.collapsed) renderSliceTab();
    q('ufBodiesInfo').textContent = ctx.bodies ? `${ctx.bodies.size} bodies loaded` : 'no bodies loaded';
    if (reframe && overlay.classList.contains('show')) { reframeToFit(); setTimeout(drawWires, 0); }
  }
  function dockCommit(a: DockAction, reframe = true): void {
    const next = ufDockReduce(dock, a, DOCK_TABS);
    if (next === dock) return;
    dock = next;
    try { localStorage.setItem(DOCK_KEY, JSON.stringify(dock)); } catch { /* storage unavailable */ }
    applyDock(reframe);
  }
  /** whole-model change from the io/mermaid tabs: rebuild the universe and repaint */
  function refreshFromModel(): void {
    build();
    persistView('load');
    render(true);
    applyDock(false); // the mermaid textarea re-reads the (re)serialised model
  }
  q('ufTabs').addEventListener('click', (ev) => {
    const tabBtn = (ev.target as HTMLElement).closest('.uf-tab') as HTMLElement | null;
    if (tabBtn?.dataset.tab) dockCommit({ type: 'setTab', tab: tabBtn.dataset.tab });
  });
  q('ufPcol').onclick = () => dockCommit({ type: 'toggleCollapse' });
  q('ufPexp').onclick = () => dockCommit({ type: 'toggleCollapse' });
  // left-border drag: width = distance from the pointer to the overlay's right edge;
  // one reframe at drag end, not per pixel
  q('ufRsz').onpointerdown = (downEv) => {
    downEv.preventDefault();
    const rsz = q('ufRsz');
    rsz.classList.add('on');
    try { rsz.setPointerCapture(downEv.pointerId); } catch { /* synthetic pointer */ }
    const move = (ev: PointerEvent) =>
      dockCommit({ type: 'resize', width: overlay.getBoundingClientRect().right - ev.clientX }, false);
    const up = () => {
      rsz.classList.remove('on');
      rsz.removeEventListener('pointermove', move);
      rsz.removeEventListener('pointerup', up);
      applyDock(true);
    };
    rsz.addEventListener('pointermove', move);
    rsz.addEventListener('pointerup', up);
  };
  // io tab: the files module's verbs — one code path shared with the legacy inputs
  q('ufSaveMmd').onclick = () => deps.files.saveMmd();
  q('ufLoadMmd').onclick = () => (q('ufLoadMmdFile') as HTMLInputElement).click();
  (q('ufLoadMmdFile') as HTMLInputElement).onchange = (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { deps.files.loadMmdText(rd.result as string); refreshFromModel(); };
    rd.readAsText(file);
    (ev.target as HTMLInputElement).value = '';
  };
  q('ufLoadBodies').onclick = () => (q('ufLoadBodiesFile') as HTMLInputElement).click();
  (q('ufLoadBodiesFile') as HTMLInputElement).onchange = (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { deps.files.loadBodies(JSON.parse(rd.result as string)); }
      catch { ctx.hooks.toast('Could not parse bodies.json'); }
      applyDock(false);   // refresh the bodies count line
      renderInspector();  // the source pane may now fill
    };
    rd.readAsText(file);
    (ev.target as HTMLInputElement).value = '';
  };
  // mermaid tab: the mermaid module stays the only parse/apply path
  q('ufMmdApply').onclick = () => {
    ctx.dom.mmd.value = (q('ufMmdText') as HTMLTextAreaElement).value;
    deps.mermaid.applyText();
    refreshFromModel();
  };
  q('ufMmdCopy').onclick = () => {
    navigator.clipboard?.writeText((q('ufMmdText') as HTMLTextAreaElement).value)
      .then(() => ctx.hooks.toast('Copied'))
      .catch(() => ctx.hooks.toast('Copy failed'));
  };
  // slice tab: one serialisation path (SliceApi.sliceFor) fed by the pure
  // ufSliceTargets mapping of unfold's own selection shape — refreshed on
  // selection commit (paint()) and on tab activation (applyDock), never
  // per-keystroke since there is none here.
  function renderSliceTab(): void {
    const wire = spec.selWire ? { a: spec.selWire.a, b: spec.selWire.b } : null;
    const result = deps.slice.sliceFor(ufSliceTargets(spec.sel, wire));
    (q('ufSliceText') as HTMLTextAreaElement).value = result.text;
    q('ufSliceInfo').textContent = result.info;
  }
  q('ufSliceCopy').onclick = () => {
    navigator.clipboard?.writeText((q('ufSliceText') as HTMLTextAreaElement).value)
      .then(() => ctx.hooks.toast('Copied'))
      .catch(() => ctx.hooks.toast('Copy failed'));
  };
  // style tab: appearance only — light/dark drives the same applyDark path as
  // the ufTheme floating-toolbar button; font drives theming.applyFont (the
  // single FONTS source), initialised from ctx.prefs.font
  q('ufStyleDark').addEventListener('click', () => applyDark(!overlay.classList.contains('dark')));
  const fontSel = q('ufFontSel') as HTMLSelectElement;
  fontSel.innerHTML = FONT_ORDER.map((k) => `<option value="${k}">${FONTS[k].name}</option>`).join('');
  fontSel.value = ctx.prefs.font;
  fontSel.onchange = () => deps.theming.applyFont(fontSel.value);
  applyDock(false);

  /* ================= MODEL (derived from ctx.state on open) ================= */
  const U = new Map<string, UNode>();
  let ROOTS: string[] = [];
  let EDGES: UEdge[] = [];
  const OUT: Record<string, UEdge[]> = {}, IN: Record<string, UEdge[]> = {};

  const prefixParent = (id: string): string | null => {
    const i = id.indexOf('__');
    return i > 0 && ctx.state.nodes[id.slice(0, i)] ? id.slice(0, i) : null;
  };
  function parentOf(node: DiagramNode): string | null {
    if (node.parent && ctx.state.nodes[node.parent]) return node.parent;
    return prefixParent(node.id);
  }

  /** populate U with each node's plain fields, then link live-parent/prefix containment */
  function populateNodesAndParents(): void {
    for (const id in ctx.state.nodes) {
      const rawNode = ctx.state.nodes[id];
      const accepts: string[] = [], returns: string[] = [];
      for (const i of rawNode.fm?.interfaces ?? []) {
        accepts.push(...i.accepts);
        returns.push(...i.returns.filter((ret) => ret && ret !== 'void'));
      }
      U.set(id, {
        id,
        label: rawNode.fm?.name || rawNode.label || id,
        kind: rawNode.kind ?? (rawNode.shape === 'group' ? 'group' : 'node'),
        desc: rawNode.fm?.description ?? '',
        accepts, returns, state: rawNode.fm?.state ?? [],
        children: [], parent: null, fanIn: 0,
      });
    }
    for (const id in ctx.state.nodes) {
      const parentId = parentOf(ctx.state.nodes[id]);
      const entry = U.get(id) as UNode;
      if (parentId && parentId !== id && U.has(parentId)) {
        entry.parent = parentId;
        (U.get(parentId) as UNode).children.push(id);
      }
    }
  }
  /** %% group hierarchy: declared groups become container levels ABOVE the
      containment roots — the reading surface's regions. No geometry, no canvas
      presence; a collision with a real node id lets the node win. */
  function applyHierGroups(): void {
    const hier = ctx.state.hier;
    if (!hier || !Object.keys(hier.groups).length) return;
    for (const gid of Object.keys(hier.groups)) {
      if (U.has(gid)) continue;
      const groupDef = hier.groups[gid];
      U.set(gid, {
        id: gid, label: groupDef.label, kind: 'group', desc: '',
        accepts: [], returns: [], state: [], children: [], parent: null, fanIn: 0,
      });
    }
    for (const gid of Object.keys(hier.groups)) {
      const parentId = hier.groups[gid].parent;
      const entry = U.get(gid);
      if (entry && parentId && U.has(parentId) && !entry.parent && parentId !== gid) { entry.parent = parentId; (U.get(parentId) as UNode).children.push(gid); }
    }
    for (const nid of Object.keys(hier.memberOf)) {
      const entry = U.get(nid), gid = hier.memberOf[nid];
      if (entry && !entry.parent && U.has(gid)) { entry.parent = gid; (U.get(gid) as UNode).children.push(nid); }
    }
  }
  /** dedupe ctx.state.edges into UEdge aggregates, then derive OUT/IN adjacency + fan-in */
  function computeEdgesAndAdjacency(): void {
    const seen = new Map<string, UEdge>();
    for (const edge of ctx.state.edges) {
      if (edge.from === edge.to || !U.has(edge.from) || !U.has(edge.to)) continue;
      const key = edge.from + ' ' + edge.to;
      if (!seen.has(key)) seen.set(key, { from: edge.from, to: edge.to, label: '', call: false, dep: false, w: 0 });
      const agg = seen.get(key) as UEdge;
      agg.w++;
      if (edge.style === 'dotted') agg.dep = true; else agg.call = true;
      if (edge.label && agg.label.length < 40) agg.label = [agg.label, edge.label].filter(Boolean).join(', ');
    }
    EDGES = [...seen.values()];
    for (const id of U.keys()) { OUT[id] = []; IN[id] = []; }
    for (const edge of EDGES) { OUT[edge.from].push(edge); IN[edge.to].push(edge); }
    for (const id of U.keys()) (U.get(id) as UNode).fanIn = new Set(IN[id].map((edge) => edge.from)).size;
  }
  function build(): void {
    U.clear(); ROOTS = []; EDGES = [];
    for (const k of Object.keys(OUT)) delete OUT[k];
    for (const k of Object.keys(IN)) delete IN[k];
    populateNodesAndParents();
    applyHierGroups();
    for (const [id, entry] of U) if (!entry.parent) ROOTS.push(id);
    computeEdgesAndAdjacency();
    // drop stale view state that no longer resolves — the schema boundary owns this
    spec = deepFreeze(normalizeViewSpec(spec, [...U.keys()]));
    overlay.classList.toggle('staged', !!spec.stage);
  }
  const gu = (id: string): UNode => U.get(id) as UNode;
  const isContainer = (node: UNode | undefined): boolean => !!node && node.children.length > 0;
  const hasAncestor = (id: string, anc: string): boolean => {
    let cur = U.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); if (cur.id === anc) return true; cur = cur.parent ? U.get(cur.parent) : undefined; }
    return false;
  };
  /** breadcrumb labels from a node up through its live ancestor chain (root-first) */
  function ancestorCrumbs(node: UNode): string[] {
    const crumbs: string[] = [];
    let x: UNode | undefined = node;
    const seen = new Set<string>();
    while (x && x.parent && !seen.has(x.id)) { seen.add(x.id); x = U.get(x.parent); if (x) crumbs.unshift(x.label); }
    return crumbs;
  }

  /* ================= VIEW STATE (M3: ONE serializable spec) =================
     screen = render(spec). The spec is the only view state; it mutates ONLY
     through the pure reduceView (core/viewspec) via apply/commit below, and
     each installed spec is frozen so a stray direct write throws in dev.
     The three assignment sites: apply(), persistView('load'), build(). */
  let spec: ViewSpec = emptyViewSpec();

  const deepFreeze = (viewSpec: ViewSpec): ViewSpec => {
    Object.freeze(viewSpec.expanded); Object.freeze(viewSpec.hidden); Object.freeze(viewSpec.layers);
    if (viewSpec.selWire) Object.freeze(viewSpec.selWire);
    return Object.freeze(viewSpec);
  };
  /** plain-data containment slice for the reducer (reads only) */
  function modelIndex(): ViewModelIndex {
    const parents: Record<string, string | null> = {}, children: Record<string, string[]> = {};
    for (const [id, entry] of U) { parents[id] = entry.parent; children[id] = entry.children; }
    return { parents, children, roots: ROOTS };
  }
  /** reduce one or more actions into a new frozen spec WITHOUT painting —
      for boundary choreography (open-seeding, travel) that repaints itself */
  function apply(...actions: ViewAction[]): void {
    let next: ViewSpec = spec;
    const modelIdx = modelIndex();
    for (const action of actions) next = reduceView(next, action, modelIdx);
    spec = deepFreeze(next);
  }
  /** the ONLY view-mutation entry: pure reduction, frozen install, then the
      per-action repaint. No handler touches view state or the DOM directly. */
  function commit(action: ViewAction): void {
    apply(action);
    paint(action);
  }
  /** per-action repaint: today's hand-tuned render subsets (stagger, staged
      pill stability, focus flow) transcribed BEHIND the commit boundary —
      an internal optimization; every pixel change is downstream of a spec
      transition. */
  function paint(action: ViewAction): void {
    switch (action.type) {
      case 'toggleExpand': case 'reveal': case 'hide':
        render(true);
        return;
      case 'foldAll':
        overlay.classList.remove('staged');
        renderStageGroup(undefined);
        render(true);
        return;
      case 'select':
        actionsMenuOpen = false; // a selection change starts the actions menu closed
        renderSliceTab();
        if (!spec.stage && spec.layers.blast) { render(false); return; }
        // U3/U6: selection only re-lights cards and wires — no rebuild, pills stay stable
        focusDim();
        renderTree();
        renderInspector();
        setTimeout(spec.stage ? drawStageWires : drawWires, 0);
        return;
      case 'selectWire': case 'focusType':
        actionsMenuOpen = false;
        if (action.type === 'selectWire') renderSliceTab();
        focusDim();
        renderInspector();
        setTimeout(spec.stage ? drawStageWires : drawWires, 0);
        return;
      case 'setStage':
        overlay.classList.toggle('staged', !!spec.stage);
        renderStageGroup(undefined);
        focusDim();
        return;
      case 'toggleLayer':
        applyLayerClasses();
        renderLayers();
        render(false);
        return;
      case 'setQuery':
        renderTree();
        return;
      case 'setFmOpen':
        renderInspector();
        return;
    }
  }
  /** clear-or-set selection without toggle semantics (boundary sites) */
  function setSel(id: string | null): void {
    if (spec.sel !== id) apply({ type: 'select', id });
  }
  /** reveal + select + full repaint — the shared "go to" path (tree label,
      inspector connections) */
  function goTo(id: string): void {
    apply({ type: 'reveal', id });
    setSel(id);
    render(true);
  }

  /** selection survives the mode boundary: seed the spec from the editor on
      open; hand the reading selection back (selectOnly + zoomToNode) on
      close. No new state — the two surfaces share one selection. */
  function selectSync(dir: 'open' | 'close'): void {
    if (dir === 'open') {
      const first = [...ctx.state.sel].find((id) => U.has(id));
      if (first) { apply({ type: 'reveal', id: first }); setSel(first); }
      return;
    }
    if (spec.sel && ctx.state.nodes[spec.sel]) {
      deps.selection.selectOnly(spec.sel);
      deps.camera.zoomToNode(spec.sel);
    }
  }

  /** reading session per diagram (sorted containment roots as identity),
      stored as the full v1 ViewSpec; load goes through normalizeViewSpec
      (the schema boundary — a pre-M3 {expanded,hidden,layers} entry is a
      valid subset, migration is branch-free) and applies the durable trio.
      sel/stage/query are carried by the format but selectSync owns
      selection at the mode boundary. */
  function persistView(dir: 'save' | 'load'): void {
    try {
      const key = 'unfold.view';
      const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      const fp = [...ROOTS].sort().join('|');
      if (!fp) return;
      if (dir === 'save') {
        all[fp] = spec;
        const keys = Object.keys(all);
        while (keys.length > 24) delete all[keys.shift() as string];
        localStorage.setItem(key, JSON.stringify(all));
        return;
      }
      const loaded = normalizeViewSpec(all[fp], [...U.keys()]);
      spec = deepFreeze({
        ...emptyViewSpec(),
        expanded: loaded.expanded,
        hidden: loaded.hidden,
        // stored layer prefs win; trust is gated on a live advisory source (runtime capability, not schema)
        layers: { ...loaded.layers, trust: loaded.layers.trust && TRUST_SRC },
      });
    } catch { /* storage unavailable — the session just doesn't persist */ }
  }

  function isRendered(id: string): boolean {
    let cur = U.get(id);
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.id)) return false;
      seen.add(cur.id);
      if (spec.hidden.includes(cur.id)) return false;
      if (!cur.parent) return true;
      if (!spec.expanded.includes(cur.parent)) return false;
      cur = U.get(cur.parent);
    }
    return true;
  }
  function visibleRep(id: string): string | null {
    let cur = U.get(id);
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      if (isRendered(cur.id)) return cur.id;
      cur = cur.parent ? U.get(cur.parent) : undefined;
    }
    return null;
  }

  /* ---- blast radius: transitive dependents of the selection ---- */
  let BLAST_N = 0;
  let REP_HOPS = new Map<string, number>();
  function computeBlast(): void {
    REP_HOPS = new Map(); BLAST_N = 0;
    if (!spec.layers.blast || !spec.sel) return;
    // U6: a selected container blasts from its whole subtree — hier groups are not
    // edge endpoints, so seeding only the group id would find nothing and dim everything
    const seeds = new Set<string>([spec.sel]);
    if (isContainer(U.get(spec.sel))) {
      (function walk(x: string): void {
        (U.get(x)?.children ?? []).forEach((childId) => { if (!seeds.has(childId)) { seeds.add(childId); walk(childId); } });
      })(spec.sel);
    }
    const hop = new Map<string, number>([...seeds].map((seed) => [seed, 0] as [string, number]));
    const bq: string[] = [...seeds];
    while (bq.length) {
      const x = bq.shift() as string;
      for (const inEdge of IN[x] ?? []) if (!hop.has(inEdge.from)) { hop.set(inEdge.from, (hop.get(x) ?? 0) + 1); bq.push(inEdge.from); }
    }
    for (const seed of seeds) hop.delete(seed);
    BLAST_N = hop.size;
    const selRep = visibleRep(spec.sel);
    for (const [id, hp] of hop) {
      const rep = visibleRep(id);
      if (!rep || rep === selRep) continue;
      const cur = REP_HOPS.get(rep);
      if (cur == null || hp < cur) REP_HOPS.set(rep, hp);
    }
  }

  /* ================= CAMERA (bounded) ================= */
  const viewXform = { x: 0, y: 0, k: 1 };
  function setT(anim?: boolean): void {
    worldEl.classList.toggle('anim', !!anim);
    worldEl.style.transform = `translate(${viewXform.x}px,${viewXform.y}px) scale(${viewXform.k})`;
  }
  const contentSize = (): { width: number; height: number } =>
    ({ width: contentEl.scrollWidth || 1, height: contentEl.scrollHeight || 1 });
  function clampPan(): void {
    const { width, height } = contentSize(), sw = stageEl.clientWidth, sh = stageEl.clientHeight, margin = 120;
    viewXform.x = Math.min(sw - margin, Math.max(margin - width * viewXform.k, viewXform.x));
    viewXform.y = Math.min(sh - margin, Math.max(margin - height * viewXform.k, viewXform.y));
  }
  function fitView(anim?: boolean): void {
    const { width, height } = contentSize(), sw = stageEl.clientWidth, sh = stageEl.clientHeight, pad = 64;
    viewXform.k = Math.max(.15, Math.min(1.15, Math.min((sw - pad * 2) / width, (sh - pad * 2) / height)));
    viewXform.x = (sw - width * viewXform.k) / 2;
    viewXform.y = Math.max(pad, (sh - height * viewXform.k) / 2);
    setT(anim);
  }
  stageEl.addEventListener('wheel', (wheelEv) => {
    wheelEv.preventDefault();
    const rect = stageEl.getBoundingClientRect(), px = wheelEv.clientX - rect.left, py = wheelEv.clientY - rect.top;
    const k2 = Math.max(.15, Math.min(2.5, viewXform.k * (wheelEv.deltaY < 0 ? 1.1 : 0.9)));
    viewXform.x = px - (px - viewXform.x) * (k2 / viewXform.k);
    viewXform.y = py - (py - viewXform.y) * (k2 / viewXform.k);
    viewXform.k = k2;
    clampPan(); setT(false);
  }, { passive: false });
  let panDrag: { sx: number; sy: number; x: number; y: number; moved: boolean } | null = null;
  stageEl.addEventListener('pointerdown', (downEv) => {
    // U1: stagelayer excluded — pointer capture on stageEl retargets click and kills stage buttons (← explore, proxies)
    if ((downEv.target as HTMLElement).closest('.uf-card,.uf-ghead,.uf-open,.uf-dock,.uf-stagelayer,.uf-whit')) return;
    panDrag = { sx: downEv.clientX, sy: downEv.clientY, x: viewXform.x, y: viewXform.y, moved: false };
    stageEl.classList.add('grab');
    stageEl.setPointerCapture(downEv.pointerId);
  });
  stageEl.addEventListener('pointermove', (moveEv) => {
    if (!panDrag) return;
    if (Math.abs(moveEv.clientX - panDrag.sx) + Math.abs(moveEv.clientY - panDrag.sy) > 3) panDrag.moved = true;
    if (!panDrag.moved) return;
    viewXform.x = panDrag.x + (moveEv.clientX - panDrag.sx);
    viewXform.y = panDrag.y + (moveEv.clientY - panDrag.sy);
    clampPan(); setT(false);
  });
  stageEl.addEventListener('pointerup', () => {
    // U2: click-without-drag on empty canvas deselects a selected wire (drag threshold 3px)
    if (panDrag && !panDrag.moved && spec.selWire) {
      commit({ type: 'selectWire', a: spec.selWire.a, b: spec.selWire.b });   // re-select = toggle off
    }
    panDrag = null; stageEl.classList.remove('grab');
  });

  /* ================= CANVAS ================= */
  function depthOf(id: string): number {
    let depth = 0, entry = U.get(id);
    const seen = new Set<string>();
    while (entry && entry.parent && !seen.has(entry.id)) { seen.add(entry.id); depth++; entry = U.get(entry.parent); }
    return depth;
  }
  function renderCanvas(): void {
    contentEl.innerHTML = '';
    const wrap = h('div');
    wrap.style.cssText = 'display:flex;gap:28px;align-items:flex-start;padding:52px;flex-wrap:wrap;max-width:2200px';
    for (const rid of ROOTS) if (isRendered(rid)) wrap.appendChild(nodeEl(rid));
    contentEl.appendChild(wrap);
  }
  const nodeEl = (id: string): HTMLElement =>
    spec.expanded.includes(id) && isContainer(U.get(id)) ? groupEl(gu(id)) : cardEl(gu(id));
  function groupEl(u: UNode): HTMLElement {
    const kids = u.children.filter((c) => !spec.hidden.includes(c));
    const allLeaf = kids.every((c) => !(spec.expanded.includes(c) && isContainer(U.get(c))));
    const grpEl = h('div', 'uf-grp open ' + (spec.sel === u.id ? 'sel ' : '') + (allLeaf ? 'leaf' : depthOf(u.id) % 2 === 0 ? 'row' : 'col'));
    grpEl.dataset.id = u.id;
    const head = h('div', 'uf-ghead',
      `<span class="uf-tw" title="Fold"><svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg></span>
       <span class="uf-gname">${esc(u.label)}</span>
       <span class="uf-gcount">${kids.length}/${u.children.length}</span>`);
    // U6: the header SELECTS the group (an information act); folding moves to the
    // chevron / dblclick — expansion is an explicit affordance, not the click default
    head.onclick = () => selectGroup(u.id);
    (head.querySelector('.uf-tw') as HTMLElement).onclick = (ev) => { ev.stopPropagation(); toggleExpand(u.id); };
    head.ondblclick = (ev) => {
      if ((ev.target as HTMLElement).closest('.uf-tw')) return;
      toggleExpand(u.id);
    };
    grpEl.appendChild(head);
    const body = h('div', 'uf-gbody');
    for (const kid of kids) body.appendChild(nodeEl(kid));
    grpEl.appendChild(body);
    return grpEl;
  }
  /** selection/blast/neighbour highlight state for one card — isolated so cardEl
      itself reads as plain assembly, not a nest of blast/selection conditionals */
  function cardHighlight(node: UNode): { sel: boolean; nbr: boolean; hop: number | undefined; dim: boolean } {
    const sel = spec.sel === node.id;
    const blastOn = spec.layers.blast && !!spec.sel;
    const hop = blastOn ? REP_HOPS.get(node.id) : undefined;
    const nbr = !blastOn && spec.sel ? !sel && isNeighbour(spec.sel, node.id) : false;
    // a selected container's members ARE the selection — they never dim under blast
    const inSel = sel || (!!spec.sel && hasAncestor(node.id, spec.sel));
    const dim = blastOn ? !inSel && hop == null : (spec.sel ? !sel && !nbr : false);
    return { sel, nbr, hop, dim };
  }
  /** card click: connect-mode target pick, then group-inspect / expand / select */
  function cardClick(node: UNode, clickOpens: boolean): (ev: MouseEvent) => void {
    return (ev) => {
      if ((ev.target as HTMLElement).isContentEditable) return;
      if ((ev.target as HTMLElement).closest('.uf-open')) return;
      // connect mode armed on a source card: this click picks the target and fires the edge
      if (connectFrom) { ev.stopPropagation(); completeConnect(node.id); return; }
      // a group card inspects in place — it must not take the module-card stage path (U8 deferred)
      if (clickOpens) toggleExpand(node.id); else if (node.kind === 'group') selectGroup(node.id); else select(node.id);
    };
  }
  /** card double-click: expand a container, otherwise rename the selected card in place */
  function cardDblClick(node: UNode, canOpen: boolean): (ev: MouseEvent) => void {
    return (ev) => {
      if ((ev.target as HTMLElement).isContentEditable) return;
      if (canOpen) toggleExpand(node.id);
      else if (spec.sel === node.id) renameInPlace(node.id);
    };
  }
  /** the card's class-list string — kind/open-affordance/selection/blast classes,
      pulled out of cardEl so the assembly function reads as one straight line */
  function cardClassName(node: UNode, canOpen: boolean, clickOpens: boolean,
    highlight: { sel: boolean; nbr: boolean; hop: number | undefined; dim: boolean }): string {
    return 'uf-card ' + (SYM_KINDS.has(node.kind) ? 'sym ' : '') + (canOpen && !clickOpens ? 'can-open ' : '')
      + (highlight.sel ? 'sel ' : '') + (highlight.nbr ? 'nbr ' : '')
      + (highlight.hop != null ? 'bh' + Math.min(3, highlight.hop) + ' ' : '') + (highlight.dim ? 'dim' : '');
  }
  /** the card's inner markup — name/meta/desc/interfaces/blast-hop/unfold-affordance */
  function cardBodyHtml(node: UNode, canOpen: boolean, clickOpens: boolean, hop: number | undefined): string {
    const meta = canOpen ? `${node.children.length} inside · fan-in ${node.fanIn}` : `${node.kind} · fan-in ${node.fanIn}`;
    return `<div class="uf-crow"><span class="uf-dot"></span><span class="uf-cname">${esc(node.label)}</span></div>
      <div class="uf-cmeta">${esc(meta)}</div>
      ${node.desc ? `<div class="uf-cdesc">${esc(node.desc)}</div>` : ''}
      ${ifaceHtml(node)}
      ${hop != null ? `<span class="uf-bhop">${hop}</span>` : ''}
      ${canOpen && !clickOpens ? `<span class="uf-open" title="Unfold"><svg viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg></span>` : ''}`;
  }
  function cardEl(u: UNode): HTMLElement {
    const canOpen = isContainer(u);
    // U6: a collapsed GROUP card selects like everything else; only generic 'node'
    // containers keep click-to-expand. Groups expand via the corner icon / dblclick.
    const clickOpens = canOpen && u.kind === 'node';
    const highlight = cardHighlight(u);
    const card = h('div', cardClassName(u, canOpen, clickOpens, highlight));
    card.dataset.id = u.id;
    if (spec.layers.color) card.style.setProperty('--uf-kc', `var(${KIND_VAR[u.kind] ?? K_FUNCTION_VAR})`);
    card.innerHTML = cardBodyHtml(u, canOpen, clickOpens, highlight.hop);
    card.onclick = cardClick(u, clickOpens);
    if (canOpen && !clickOpens) {
      (card.querySelector('.uf-open') as HTMLElement).onclick = (ev) => { ev.stopPropagation(); toggleExpand(u.id); };
    }
    card.ondblclick = cardDblClick(u, canOpen);
    return card;
  }
  function ifaceHtml(u: UNode): string {
    const rows: string[] = [];
    const addRow = (l: string, a: string[]): void => {
      if (a.length) rows.push(`<div class="uf-ilab">${l}</div>` + a.slice(0, 4).map((x) => `<div class="uf-irow">${ifaceLine(x)}</div>`).join(''));
    };
    addRow('accepts', u.accepts); addRow('returns', u.returns); addRow('state', u.state);
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
    const rect = el.getBoundingClientRect(), cr = contentEl.getBoundingClientRect(), k = viewXform.k;
    return {
      x: (rect.left - cr.left) / k, y: (rect.top - cr.top) / k, w: rect.width / k, h: rect.height / k,
      cx: (rect.left - cr.left) / k + rect.width / k / 2, cy: (rect.top - cr.top) / k + rect.height / k / 2,
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
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('->')) continue;
      ALLOW.add(trimmed);
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
      const file = trustFileEl.files?.[0];
      if (!file) return;
      void file.text().then((t) => { parseAllow(t); TRUST_SRC = true; renderLayers(); render(false); });
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
         editor canvas. Keyed by a layout signature so a stale reply is dropped.
         Lifted wires connect SIBLINGS, so each containment scope routes on its own:
         the obstacles are exactly that scope's sibling boxes (cards AND group boxes),
         and a wire bends around a foreign container instead of crossing it. Atomic
         reveals legitimately cross group borders and route against cards only. ---- */
  let ROUTE_SIG = '';
  let routeSeq = 0;
  const ROUTES = new Map<string, Point[]>();
  type RouteScope = { rects: Map<string, AdhocRect>; edges: AdhocEdge[] };
  /** group wires sharing a containment scope (same parent pair, or the atomic
      pseudo-scope) into the per-scope edge lists routeGraph will lay out one
      scope at a time — pulled out of requestRoutes so that loop reads plainly */
  function buildRouteScopes(pos: Record<string, Box>, wires: LiftedWire[]): Map<string, RouteScope> {
    const scopes = new Map<string, RouteScope>();
    for (const w2 of wires) {
      if (!pos[w2.a] || !pos[w2.b]) continue;
      const pa = U.get(w2.a)?.parent ?? null, pb = U.get(w2.b)?.parent ?? null;
      // ancestor↔descendant wires keep their elbows: no scope contains both fairly
      const sk = w2.atomic ? '~atomic' : pa === pb ? (pa ?? '~root') : null;
      if (sk == null) continue;
      if (!scopes.has(sk)) scopes.set(sk, { rects: new Map(), edges: [] });
      (scopes.get(sk) as RouteScope).edges.push({ id: w2.a + ' ' + w2.b, source: w2.a, target: w2.b });
    }
    return scopes;
  }
  /** fill in each scope's obstacle rects: every sibling under that scope's
      parent (or every card, for the atomic pseudo-scope), plus a fallback for
      any edge endpoint the scope membership pass missed */
  /** every id that belongs in scope `sk`'s obstacle set: every card, for the
      atomic pseudo-scope; every sibling under that parent, otherwise */
  function scopeMemberIds(sk: string, pos: Record<string, Box>): string[] {
    if (sk === '~atomic') {
      const ids: string[] = [];
      contentEl.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => { if (el.dataset.id) ids.push(el.dataset.id); });
      return ids;
    }
    const parent = sk === '~root' ? null : sk;
    return Object.keys(pos).filter((id) => (U.get(id)?.parent ?? null) === parent);
  }
  /** any edge endpoint the membership pass missed still needs a rect, so its wire has an obstacle to route against */
  function fillScopeEdgeFallback(sc: RouteScope, rectOf: (id: string) => AdhocRect | null): void {
    for (const e2 of sc.edges) {
      for (const id of [e2.source, e2.target]) {
        if (!sc.rects.has(id)) { const rect = rectOf(id); if (rect) sc.rects.set(id, rect); }
      }
    }
  }
  function fillRouteScopeRects(scopes: Map<string, RouteScope>, pos: Record<string, Box>,
    rectOf: (id: string) => AdhocRect | null): void {
    for (const [sk, sc] of scopes) {
      for (const id of scopeMemberIds(sk, pos)) { const rect = rectOf(id); if (rect) sc.rects.set(id, rect); }
      fillScopeEdgeFallback(sc, rectOf);
    }
  }
  function requestRoutes(pos: Record<string, Box>, wires: LiftedWire[]): void {
    const sig = Object.keys(pos).sort().map((id) => {
      const b2 = pos[id];
      return `${id}:${Math.round(b2.x)},${Math.round(b2.y)},${Math.round(b2.w)},${Math.round(b2.h)}`;
    }).join('|') + '||' + wires.map((w2) => (w2.atomic ? 'A' : 'L') + w2.a + '>' + w2.b).sort().join(';');
    if (sig === ROUTE_SIG) return;
    ROUTE_SIG = sig;
    ROUTES.clear();
    if (!wires.length) return;
    const rectOf = (id: string): AdhocRect | null => {
      const b2 = pos[id];
      return b2 ? { id, x: b2.x, y: b2.y, width: b2.w, height: b2.h } : null;
    };
    const scopes = buildRouteScopes(pos, wires);
    fillRouteScopeRects(scopes, pos, rectOf);
    const mySeq = ++routeSeq;
    for (const sc of scopes.values()) {
      void routeGraph([...sc.rects.values()], sc.edges).then((routes) => {
        if (mySeq !== routeSeq || sig !== ROUTE_SIG) return; // layout moved on — drop
        for (const route of routes) ROUTES.set(route.id, route.poly);
        if (routes.length) drawWires();                      // repaint upgrades elbows in place
      });
    }
  }

  /* ---- U2: wires are selectable, informative objects (legacy-editor parity) ---- */

  /** select an aggregated wire by its rendered rep pair; the reducer clears
      node/type focus (mutual exclusion) and a re-click toggles off. Never
      enters stage mode — a wire is information, not travel. */
  function selectWire(a: string, b: string): void {
    commit({ type: 'selectWire', a, b });
  }

  /** append an invisible wide hit path over a drawn wire: click selects, hover pre-lights */
  function wireHit(vis: SVGPathElement, d: string, a: string, b: string, host: SVGSVGElement): void {
    const hp = document.createElementNS(NS, 'path') as SVGPathElement;
    hp.setAttribute('d', d);
    hp.setAttribute('class', 'uf-whit');
    hp.onclick = (e) => { e.stopPropagation(); selectWire(a, b); };
    hp.onpointerenter = () => vis.classList.add('uf-whov');
    hp.onpointerleave = () => vis.classList.remove('uf-whov');
    host.appendChild(hp);
  }

  /** the ONE wire-picture decision (pure, acceptance-tested): EDGES + advisory
      flags projected through ufLiftWires. `neutral` recomputes with no selection
      — the aggregate story a click should target regardless of what is revealed. */
  function computeLifted(neutral?: boolean): LiftedWire[] {
    const idx = modelIndex();
    return ufLiftWires(
      EDGES.map((e) => ({ from: e.from, to: e.to, call: e.call, dep: e.dep, w: e.w, adv: ALLOW.has(e.from + '->' + e.to) })),
      {
        parents: idx.parents,
        expanded: [...spec.expanded],
        hidden: [...spec.hidden],
        sel: neutral ? null : spec.sel,
        selWire: neutral ? null : spec.selWire,
        layers: { calls: spec.layers.calls, deps: spec.layers.deps },
      },
    );
  }

  /** mid-path concealed-count badge: the aggregate admits how many real
      endpoints it hides; click selects (= opens) the wire */
  function wireBadge(p: SVGPathElement, it: LiftedWire, hit: { a: string; b: string }, dim: boolean): void {
    let mid: DOMPoint;
    try {
      const len = p.getTotalLength();
      if (!len) return;
      mid = p.getPointAtLength(len / 2);
    } catch { return; }
    const badgeEl = document.createElementNS(NS, 'g');
    badgeEl.setAttribute('class', 'uf-wb' + (it.hot ? ' hot' : '') + (dim ? ' dim' : ''));
    const label = String(it.concealed);
    const bw = 8 + label.length * 6;
    const rectEl = document.createElementNS(NS, 'rect');
    rectEl.setAttribute('x', String(mid.x - bw / 2)); rectEl.setAttribute('y', String(mid.y - 7));
    rectEl.setAttribute('width', String(bw)); rectEl.setAttribute('height', '14'); rectEl.setAttribute('rx', '7');
    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('x', String(mid.x)); tx.setAttribute('y', String(mid.y));
    tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('dominant-baseline', 'central');
    tx.textContent = label;
    badgeEl.appendChild(rectEl); badgeEl.appendChild(tx);
    badgeEl.onclick = (e) => { e.stopPropagation(); selectWire(hit.a, hit.b); };
    wiresEl.appendChild(badgeEl);
  }

  /** ONE arrowhead marker def: direction is drawn only on atomic reveals (a
      lifted aggregate is a two-way conversation — an arrow on it would be a guess) */
  function buildArrowheadDefs(selCol: string): SVGDefsElement {
    const defs = document.createElementNS(NS, 'defs') as SVGDefsElement;
    const mAh = document.createElementNS(NS, 'marker');
    mAh.setAttribute('id', 'ufAhh'); mAh.setAttribute('viewBox', '0 0 8 8');
    mAh.setAttribute('refX', '6.2'); mAh.setAttribute('refY', '4');
    mAh.setAttribute('markerWidth', '6'); mAh.setAttribute('markerHeight', '6');
    mAh.setAttribute('orient', 'auto-start-reverse');
    const mp = document.createElementNS(NS, 'path');
    mp.setAttribute('d', 'M1.4 1.6 L6 4 L1.4 6.4'); mp.setAttribute('fill', 'none');
    mp.setAttribute('stroke', selCol); mp.setAttribute(ATTR_STROKE_WIDTH, '1.8');
    mp.setAttribute(ATTR_STROKE_LINECAP, STROKE_ROUND); mp.setAttribute('stroke-linejoin', STROKE_ROUND);
    mAh.appendChild(mp);
    defs.appendChild(mAh);
    return defs;
  }
  /** the rendered rep pair a click on this lifted wire should select: an atomic
      reveal targets the NEUTRAL aggregate that carries it (re-click toggles off) */
  function hitPairOf(it: LiftedWire, neutral: LiftedWire[]): { a: string; b: string } {
    if (!it.atomic) return { a: it.a, b: it.b };
    const u0 = it.underlying[0];
    const agg = u0 ? neutral.find((n) => n.underlying.some((u2) => u2.from === u0.from && u2.to === u0.to)) : undefined;
    return agg ? { a: agg.a, b: agg.b } : { a: it.a, b: it.b };
  }
  interface WirePaintCtx {
    edgeCol: string; selCol: string; advCol: string; pos: Record<string, Box>;
    outDeg: Map<string, number>; blastOn: boolean; selRep: string | null;
    selActive: boolean; maxw: number; neutral: LiftedWire[];
  }
  /** paint one lifted wire: geometry, the weight/selection colour+opacity ramp,
      first-paint entrance animation, its hit target, and its concealed-count
      badge — the drawWires loop body pulled out so the loop itself reads plainly */
  /** stroke colour ramp: hot (selection-lit) wins, then advisory, then the plain edge colour */
  function wireStrokeColor(hot: boolean, adv: boolean, wc: WirePaintCtx): string {
    if (hot) return wc.selCol;
    return adv ? wc.advCol : wc.edgeCol;
  }
  /** opacity ramp: selection focus dims everything but the hot/in-blast set;
      otherwise weight alone carries it — advisory wires get an honesty floor */
  function wireOpacity(hot: boolean, inBlast: boolean, adv: boolean, wc: WirePaintCtx, t: number): number {
    const base = wc.selActive ? (hot ? .95 : inBlast ? .55 : .13) : .18 + .55 * t;
    return adv ? Math.max(base, .5) : base;
  }
  /** first-paint entrance: a wire that has never been drawn before (and isn't
      hot/advisory) draws itself in after its cards land, once only */
  function markWireEntrance(p: SVGPathElement, key: string, hot: boolean, adv: boolean): void {
    if (wiresEverDrawn.has(key)) return;
    wiresEverDrawn.add(key);
    if (hot || adv) return;
    p.setAttribute('pathLength', '1');
    p.classList.add('uf-enter');
    p.style.animationDelay = Math.max(0, wireEnterAt - performance.now()) + 'ms';
  }
  function paintWireItem(it: LiftedWire, wc: WirePaintCtx): void {
    const hot = it.hot;
    const adv = spec.layers.trust && it.adv;
    const inBlast = wc.blastOn && (REP_HOPS.has(it.a) || it.a === wc.selRep) && (REP_HOPS.has(it.b) || it.b === wc.selRep);
    const hub = !hot && (wc.outDeg.get(it.a) ?? 0) > 8;
    // weight ramp: the heavy flows carry the story, the light ones recede instead of stacking into noise
    const ramp = Math.pow(it.w / wc.maxw, .6) * (hub ? .35 : 1);
    const width = 1 + ramp * 2.4;
    const pathEl = document.createElementNS(NS, 'path');
    const routed = ROUTES.get(it.a + ' ' + it.b);
    pathEl.setAttribute('d', routed ? polyPath(routed) : wirePath(wc.pos[it.a], wc.pos[it.b]));
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', wireStrokeColor(hot, adv, wc));
    pathEl.setAttribute(ATTR_STROKE_WIDTH, String(hot ? Math.max(1.6, width) : width));
    pathEl.setAttribute('stroke-opacity', String(wireOpacity(hot, inBlast, adv, wc, ramp)));
    pathEl.setAttribute(ATTR_STROKE_LINECAP, STROKE_ROUND);
    if (adv) pathEl.setAttribute('stroke-dasharray', '4 3');
    if (it.atomic) pathEl.setAttribute('marker-end', 'url(#ufAhh)');
    if (hot) pathEl.classList.add('uf-hot');   // flow animation: the selection's wires visibly carry traffic
    markWireEntrance(pathEl as SVGPathElement, it.a + ' ' + it.b, hot, adv);
    wiresEl.appendChild(pathEl);
    const hit = hitPairOf(it, wc.neutral);
    wireHit(pathEl as SVGPathElement, pathEl.getAttribute('d') as string, hit.a, hit.b, wiresEl);
    if (it.concealed > 0 && !it.atomic) wireBadge(pathEl as SVGPathElement, it, hit, wc.selActive && !hot);
  }
  function drawWires(): void {
    wiresEl.innerHTML = '';
    if (!spec.layers.calls && !spec.layers.deps) return;
    const { width, height } = contentSize();
    wiresEl.setAttribute('width', String(width));
    wiresEl.setAttribute('height', String(height));
    const edgeCol = cvar('--uf-dim') || '#948f84', selCol = cvar('--uf-accent') || '#4a6b8a';
    const advCol = cvar(K_STORE_VAR) || '#a8824a';
    wiresEl.appendChild(buildArrowheadDefs(selCol));
    const pos: Record<string, Box> = {};
    contentEl.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => { pos[el.dataset.id as string] = box(el); });
    const lifted = computeLifted().filter((it) => pos[it.a] && pos[it.b]);
    // clicks always target the NEUTRAL aggregate that carries the wire, so a
    // click on any revealed strand selects the aggregate story (re-click toggles off)
    const neutral = spec.sel || spec.selWire ? computeLifted(true) : lifted;
    const selActive = !!spec.sel || !!spec.selWire;
    const selRep = spec.sel ? visibleRep(spec.sel) : null;
    const blastOn = spec.layers.blast && !!selRep;
    const maxw = Math.max(1, ...lifted.map((x) => x.w));
    const items = [...lifted].sort((x, y) => (x.hot ? 1 : 0) - (y.hot ? 1 : 0)); // hot paints on top
    requestRoutes(pos, items);
    // a hub's fan-out (the composition root, a config read by everyone) is structure, not story:
    // each of its edges says little, so collectively they recede unless the selection asks for them
    const outDeg = new Map<string, number>();
    for (const it of items) outDeg.set(it.a, (outDeg.get(it.a) ?? 0) + 1);
    const wc: WirePaintCtx = { edgeCol, selCol, advCol, pos, outDeg, blastOn, selRep, selActive, maxw, neutral };
    for (const it of items) paintWireItem(it, wc);
  }

  /* ================= STAGE + FOCUS (approved v3 "stage" design) =================
     Canvas coordinates stay the single spatial truth; stage mode is a SECOND
     PROJECTION of the same graph. Proxy directions derive from group centroids
     in ctx.state positions — the human's manual layout is the source of angles. */
  // spec.stage / spec.focusType carry the projection; only animation infra lives here
  let prevShown = new Set<string>();      // entrance-stagger diffing
  let wireEnterAt = 0;                    // wires draw in only after cards land
  let wiresEverDrawn = new Set<string>();

  const stageLayer = h('div', 'uf-stagelayer');
  stageLayer.innerHTML = '<svg class="uf-swires" xmlns="http://www.w3.org/2000/svg"></svg>';
  stageEl.appendChild(stageLayer);
  const sWiresEl = stageLayer.querySelector('.uf-swires') as unknown as SVGSVGElement;

  /** the staged container plus every ancestor above it (the stage's frame set) */
  function stageFrameIds(): Set<string> {
    const ids = new Set<string>();
    if (!spec.stage) return ids;
    ids.add(spec.stage);
    let cur = U.get(spec.stage);
    const seen = new Set<string>();
    while (cur && cur.parent && !seen.has(cur.id)) { seen.add(cur.id); ids.add(cur.parent); cur = U.get(cur.parent); }
    return ids;
  }
  /** aggregation target for a proxy pill: the COARSEST ancestor of `outside`
      that does not contain the staged subtree — a sibling in the same group
      stays itself; a foreign subtree compresses into its top group */
  function proxyTargetOf(outside: string, frame: Set<string>): string {
    let cur = U.get(outside);
    const seen = new Set<string>();
    const chain: string[] = [];
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.push(cur.id); cur = cur.parent ? U.get(cur.parent) : undefined; }
    for (let i = chain.length - 1; i >= 0; i--) if (!frame.has(chain[i])) return chain[i];
    return outside;
  }
  /** ancestor-or-self that is a DIRECT child of the staged container; null when outside it */
  function stageRepOf(id: string): string | null {
    let cur = U.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.id === spec.stage) return null;
      if (cur.parent === spec.stage) return cur.id;
      cur = cur.parent ? U.get(cur.parent) : undefined;
    }
    return null;
  }
  /** mean center of a container subtree in ctx.state world coordinates */
  function centroidOf(rid: string): { x: number; y: number } {
    let sx = 0, sy = 0, count = 0;
    (function walk(id: string): void {
      const nd = ctx.state.nodes[id];
      if (nd) { sx += nd.x + nd.w / 2; sy += nd.y + nd.h / 2; count++; }
      (U.get(id)?.children ?? []).forEach(walk);
    })(rid);
    return count ? { x: sx / count, y: sy / count } : { x: 0, y: 0 };
  }
  const baseType = (s: string): string => {
    const i = s.indexOf(':');
    return (i >= 0 ? s.slice(i + 1) : s).trim().replace(/\[\]$/, '');
  };
  function carriesType(id: string, t: string): boolean {
    const node = U.get(id);
    if (!node) return false;
    return [...node.accepts, ...node.returns, ...node.state].some((x) => baseType(x) === t);
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
    const blastOn = spec.layers.blast && !!spec.sel;
    overlay.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => {
      const id = el.dataset.id as string;
      const sel = spec.sel === id;
      const lit = !!spec.focusType && carriesType(id, spec.focusType);
      const wep = !!spec.selWire && (spec.selWire.a === id || spec.selWire.b === id);   // U2: a selected wire lights its endpoints
      el.classList.toggle('sel', sel);
      el.classList.toggle('lit', lit || wep);
      if (!blastOn) {
        const nbr = !spec.focusType && !!spec.sel && !sel && isNeighbour(spec.sel, id);
        const dim = spec.focusType ? !lit : spec.selWire ? !wep : (spec.sel ? !sel && !nbr : false);
        el.classList.toggle('nbr', nbr);
        el.classList.toggle('dim', dim);
      }
    });
    // U6: a selected group frame carries the ring too (member cards handle their own dim)
    overlay.querySelectorAll<HTMLElement>('.uf-grp').forEach((el) =>
      el.classList.toggle('sel', spec.sel === el.dataset.id));
    overlay.querySelectorAll<HTMLElement>('.uf-t').forEach((s) =>
      s.classList.toggle('hit', s.dataset.t === spec.focusType));
  }

  /** animated reframe: the world transform-scales so all visible content fits (~.9s expo) */
  function reframeToFit(): void {
    worldEl.classList.remove('anim');
    worldEl.classList.add('anim2');
    const { width, height } = contentSize(), sw = stageEl.clientWidth, sh = stageEl.clientHeight, pad = 64;
    viewXform.k = Math.max(.15, Math.min(1.15, Math.min((sw - pad * 2) / width, (sh - pad * 2) / height)));
    viewXform.x = (sw - width * viewXform.k) / 2;
    viewXform.y = Math.max(pad, (sh - height * viewXform.k) / 2);
    worldEl.style.transform = `translate(${viewXform.x}px,${viewXform.y}px) scale(${viewXform.k})`;
    setTimeout(() => worldEl.classList.remove('anim2'), 950);
  }

  /** type focus: every carrier module lights across the surface; inspector lists carriers */
  function typeFocus(t: string | null): void {
    commit({ type: 'focusType', t });
  }
  overlay.addEventListener('click', (e) => {
    const tk = (e.target as HTMLElement).closest('.uf-t') as HTMLElement | null;
    if (!tk) return;
    e.stopPropagation();
    typeFocus(spec.focusType === tk.dataset.t ? null : (tk.dataset.t as string));
  }, true);

  /** stage projection: focused group center-stage; explore world blurred behind. Exit restores explore exactly.
      (a projection change invalidates a wire selection — the reducer owns that rule) */
  function stageMode(gid: string | null): void {
    commit({ type: 'setStage', id: gid });
  }
  function renderStageGroup(dirFrom?: number): void {
    stageLayer.querySelectorAll('.uf-sgroup,.uf-proxy').forEach((x) => x.remove());
    sWiresEl.innerHTML = '';
    if (!spec.stage) return;
    const stageU = gu(spec.stage);
    const crumbs = ancestorCrumbs(stageU);
    const sgroupEl = h('div', 'uf-sgroup',
      `<div class="uf-shead"><span class="uf-slabel">${esc(stageU.label)}</span>
        <span class="uf-strail">${esc(crumbs.join(' / '))}</span>
        <button class="uf-sleave">← explore</button></div>`);
    const wrap = h('div', 'uf-sbody');
    for (const kid of stageU.children) if (!spec.hidden.includes(kid)) wrap.appendChild(cardEl(gu(kid)));
    sgroupEl.appendChild(wrap);
    (sgroupEl.querySelector('.uf-sleave') as HTMLElement).onclick = () => {
      setSel(null); stageMode(null); renderInspector(); setTimeout(drawWires, 0);
    };
    if (dirFrom !== undefined) {
      sgroupEl.style.transition = 'none';
      sgroupEl.style.transform =
        `translate(calc(-50% + ${Math.round(Math.cos(dirFrom) * 70)}px),calc(-50% + ${Math.round(Math.sin(dirFrom) * 70)}px)) scale(.94)`;
      setTimeout(() => { sgroupEl.style.transition = ''; sgroupEl.style.transform = ''; }, 30);
    }
    stageLayer.appendChild(sgroupEl);
    stageProxies();
    setTimeout(drawStageWires, 60);
  }

  /** U4: silent stage refresh — rebuild the projection from CURRENT view state
      (layers, hidden, blast, selection) without replaying entrance transitions.
      Called by render() so both projections subscribe to the same state. */
  function refreshStage(): void {
    if (!spec.stage) return;
    const stageU = U.get(spec.stage);
    if (!stageU || !stageU.children.some((c) => !spec.hidden.includes(c))) {
      // staged container gone or emptied by reveal toggles — exit to explore
      stageMode(null);
      return;
    }
    renderStageGroup(undefined);
    const settle = (el: HTMLElement): void => {
      el.style.transition = 'none';
      el.style.transitionDelay = '0ms';
      el.style.opacity = '1';
      setTimeout(() => { el.style.transition = ''; el.style.transitionDelay = ''; el.style.opacity = ''; }, 40);
    };
    const sgroupEl = stageLayer.querySelector('.uf-sgroup') as HTMLElement | null;
    if (sgroupEl) settle(sgroupEl);
    stageLayer.querySelectorAll<HTMLElement>('.uf-proxy').forEach(settle);
  }

  /** directional proxy pills: external edges aggregate per target container; angle = true angle between centroids.
      Edge-granularity honesty: cross-module edges in this model attach at MODULE level, so an edge incident to the
      staged container itself or its ancestor chain is FRAME-attributed (no child anchor) — without that a staged
      sub-group shows no connections at all. Child-attributed links obey the selection filter; frame links persist. */
  interface PLink { inside: string | null; outside: string }
  interface ProxyEntry { og: string; links: PLink[]; ang: number }
  /** one external link per edge crossing the stage frame, aggregated to its
      coarsest foreign container — the raw material stageProxies lays out */
  function collectProxyLinks(frameIds: Set<string>): Map<string, PLink[]> {
    const byRoot = new Map<string, PLink[]>();
    for (const edge of EDGES) {
      const ra = stageRepOf(edge.from), rb = stageRepOf(edge.to);
      let inside: string | null = null, outside: string | null = null;
      if ((ra || frameIds.has(edge.from)) && !rb && !frameIds.has(edge.to)) { inside = ra; outside = edge.to; }
      else if ((rb || frameIds.has(edge.to)) && !ra && !frameIds.has(edge.from)) { inside = rb; outside = edge.from; }
      else continue;
      // U3: pill set is STABLE across selection — selection is expressed in the wires, not by mutating the pills
      if (stageRepOf(outside)) continue; // inside the staged subtree after all
      const og = proxyTargetOf(outside, frameIds);
      if (!byRoot.has(og)) byRoot.set(og, []);
      (byRoot.get(og) as PLink[]).push({ inside, outside });
    }
    return byRoot;
  }
  /** de-overlap pass: a near-1-D editor layout clusters the true angles; spread pills
      apart while preserving the true angular ORDER (the spatial meaning the human laid out) */
  function deoverlapAngles(entries: ProxyEntry[], minSep: number): void {
    for (let pass = 0; pass < 24 && entries.length > 1; pass++) {
      let moved = false;
      for (let j = 0; j < entries.length; j++) {
        const p1 = entries[j], p2 = entries[(j + 1) % entries.length];
        let gap = p2.ang - p1.ang;
        if (j === entries.length - 1) gap += Math.PI * 2;
        if (gap < minSep - 1e-4) { const push = (minSep - gap) / 2; p1.ang -= push; p2.ang += push; moved = true; }
      }
      if (!moved) break;
    }
  }
  /** one directional proxy pill element, placed on the ring around the staged group */
  function buildProxyEl(entry: ProxyEntry, center: { cx: number; cy: number; radius: number }, delayIndex: number): HTMLElement {
    const { og, links, ang } = entry;
    const pillEl = h('div', 'uf-proxy');
    pillEl.dataset.gid = og;
    pillEl.dataset.ang = String(ang);
    if (links.some((l) => l.inside === null)) pillEl.dataset.frame = '1';
    const gl = gu(og).label;
    const names = [...new Set(links.map((l) => U.get(l.outside)?.label ?? l.outside))].filter((n) => n !== gl);
    pillEl.innerHTML = `<span class="uf-pdot"></span>${names.length ? `<span>${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ' +' + (names.length - 3) : ''}</span>` : ''}
      <span class="uf-pgrp">${esc(gl)}</span>`;
    pillEl.style.left = (center.cx + Math.cos(ang) * center.radius * 1.05) + 'px';
    pillEl.style.top = (center.cy + Math.sin(ang) * center.radius * .9) + 'px';
    pillEl.style.transitionDelay = (120 + delayIndex * 70) + 'ms';
    pillEl.onclick = (e) => { e.stopPropagation(); peekProxy(pillEl, og, links.map((l) => l.outside), ang); };
    return pillEl;
  }
  function stageProxies(): void {
    stageLayer.querySelectorAll('.uf-proxy').forEach((p) => p.remove());
    if (!spec.stage) return;
    const frameIds = stageFrameIds();
    const byRoot = collectProxyLinks(frameIds);
    const cx = stageEl.clientWidth / 2, cy = stageEl.clientHeight / 2;
    const radius = Math.min(stageEl.clientWidth, stageEl.clientHeight) * .40;
    const center = centroidOf(spec.stage);
    const entries = [...byRoot.entries()].map(([og, links]) => {
      const other = centroidOf(og);
      return { og, links, ang: Math.atan2(other.y - center.y, other.x - center.x) };
    }).sort((x, y) => x.ang - y.ang);
    const minSep = Math.min(.55, (Math.PI * 2) / Math.max(entries.length, 1));
    deoverlapAngles(entries, minSep);
    entries.forEach((entry, i) => stageLayer.appendChild(buildProxyEl(entry, { cx, cy, radius }, i)));
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
      setSel(uniq[0] && gu(og).children.includes(uniq[0]) ? uniq[0] : null);
      stageTravel(og, ang);
    };
    p.onclick = (e) => { e.stopPropagation(); p.remove(); stageProxies(); setTimeout(drawStageWires, 0); };
  }
  function stageTravel(target: string, fromAngle: number): void {
    if (!U.has(target)) return;
    if (!gu(target).children.length) {
      // a childless module has nothing to project — land in explore with it selected
      apply({ type: 'setStage', id: null }, { type: 'reveal', id: target });
      setSel(target);
      overlay.classList.remove('staged');
      render(true);
      return;
    }
    apply({ type: 'setStage', id: target });
    overlay.classList.add('staged');
    renderStageGroup(fromAngle + Math.PI);
    focusDim();
    renderTree();
    renderInspector();
  }

  /** stage wires: intra-stage curves between staged cards + curved wires to proxy pills; selection carries the flow */
  interface StageWireCtx {
    pos: Record<string, DOMRect>; sr: DOMRect; frame: Set<string>;
    wireOn: (e: UEdge) => boolean; mkPath: (d: string, hot: boolean) => SVGPathElement;
    repIn: (id: string) => string | null; rel: (r: DOMRect) => { x: number; y: number };
  }
  /** curved wires from each staged card to the directional proxy pills outside the frame
      (plus a frame-attributed fallback for pills with no child anchor) — split out of
      drawStageWires so that function reads as intra-stage wires, then proxy wires */
  function drawStageProxyWires(wc: StageWireCtx): void {
    stageLayer.querySelectorAll<HTMLElement>('.uf-proxy').forEach((px) => {
      const og = px.dataset.gid as string, pr = px.getBoundingClientRect();
      const bx = pr.left - wc.sr.left + pr.width / 2, by = pr.top - wc.sr.top + pr.height / 2;
      const linked = new Set<string>();
      for (const edge of EDGES) {
        if (!wc.wireOn(edge)) continue;
        const ra = wc.repIn(edge.from), rb = wc.repIn(edge.to);
        let source: string | null = null;
        if (ra && !rb && proxyTargetOf(edge.to, wc.frame) === og) source = ra;
        else if (rb && !ra && proxyTargetOf(edge.from, wc.frame) === og) source = rb;
        if (!source || linked.has(source)) continue;
        linked.add(source);
        const pa = wc.rel(wc.pos[source]);
        const mx = (pa.x + bx) / 2, my = (pa.y + by) / 2;
        // U3: non-selected wires stay visible but recede (mkPath dims when selected) — no more vanish-on-deselect flip
        sWiresEl.appendChild(wc.mkPath(`M ${pa.x} ${pa.y} Q ${mx} ${pa.y} ${mx} ${my} T ${bx} ${by}`, !!spec.sel && source === spec.sel));
      }
      // frame-attributed pill with no child anchor: wire from the stage-group frame edge toward the pill
      if (!linked.size && px.dataset.frame) {
        const gEl = stageLayer.querySelector('.uf-sgroup');
        if (gEl) {
          const gr = gEl.getBoundingClientRect();
          const ga = { x: gr.left - wc.sr.left + gr.width / 2, y: gr.top - wc.sr.top + gr.height / 2 };
          const fang = Math.atan2(by - ga.y, bx - ga.x);
          const fx = ga.x + Math.cos(fang) * (gr.width / 2), fy = ga.y + Math.sin(fang) * (gr.height / 2);
          const mx = (fx + bx) / 2, my = (fy + by) / 2;
          sWiresEl.appendChild(wc.mkPath(`M ${fx} ${fy} Q ${mx} ${fy} ${mx} ${my} T ${bx} ${by}`, false));
        }
      }
    });
  }
  function drawStageWires(): void {
    sWiresEl.innerHTML = '';
    if (!spec.stage) return;
    if (!spec.layers.calls && !spec.layers.deps) return;  // U3/U4: stage wires obey the same wire layers as the canvas
    const wireOn = (e: UEdge): boolean => (e.call && spec.layers.calls) || (e.dep && spec.layers.deps);
    const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
    sWiresEl.setAttribute('viewBox', `0 0 ${sw} ${sh}`);
    const sr = stageEl.getBoundingClientRect();
    const pos: Record<string, DOMRect> = {};
    stageLayer.querySelectorAll<HTMLElement>('.uf-sgroup .uf-card').forEach((el) => {
      pos[el.dataset.id as string] = el.getBoundingClientRect();
    });
    const edgeCol = cvar('--uf-dim') || '#948f84', selCol = cvar('--uf-accent') || '#4a6b8a';
    // U3: a selection DIMS the other wires instead of erasing them — same grammar as drawWires
    const mkPath = (d: string, hot: boolean): SVGPathElement => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', hot ? selCol : edgeCol);
      p.setAttribute(ATTR_STROKE_WIDTH, hot ? '1.8' : '1.2');
      p.setAttribute('stroke-opacity', hot ? '.95' : spec.sel || spec.selWire ? '.16' : '.5');
      p.setAttribute(ATTR_STROKE_LINECAP, STROKE_ROUND);
      if (hot) p.classList.add('uf-hot');
      return p;
    };
    const rel = (r: DOMRect): { x: number; y: number } => ({ x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2 });
    const repIn = (id: string): string | null => { const r = stageRepOf(id); return r && pos[r] ? r : null; };
    const seenK = new Set<string>();
    for (const edge of EDGES) {
      if (!wireOn(edge)) continue;
      const repA = repIn(edge.from), repB = repIn(edge.to);
      if (!repA || !repB || repA === repB) continue;
      const k = repA + ' ' + repB;
      if (seenK.has(k)) continue;
      seenK.add(k);
      const pa = rel(pos[repA]), pb = rel(pos[repB]);
      const wsel = !!spec.selWire && repA === spec.selWire.a && repB === spec.selWire.b;
      const hot = wsel || (!!spec.sel && (repA === spec.sel || repB === spec.sel));
      const pathD = `M ${pa.x} ${pa.y} C ${(pa.x + pb.x) / 2} ${pa.y} ${(pa.x + pb.x) / 2} ${pb.y} ${pb.x} ${pb.y}`;
      const vp = mkPath(pathD, hot);
      sWiresEl.appendChild(vp);
      wireHit(vp, pathD, repA, repB, sWiresEl);   // U2: stage wires are selectable too
    }
    const frame = stageFrameIds();
    drawStageProxyWires({ pos, sr, frame, wireOn, mkPath, repIn, rel });
  }

  /* ================= WRITE-THROUGH (never a private write path) ================= */
  const fmEditor = initInspectorFrontmatter(ctx);

  /** inline rename on the selected card (Enter / double-click on selected), writing
      through the existing model path — mutate ctx.state, then hooks render + sync +
      pushHistory + persist. Never a private write path. */
  function renameInPlace(id: string): void {
    const node = ctx.state.nodes[id];
    const scope: HTMLElement = spec.stage ? stageLayer : contentEl;
    const name = scope.querySelector<HTMLElement>(`.uf-card[data-id="${window.CSS.escape(id)}"] .uf-cname`);
    if (!node || !name || name.isContentEditable) return;
    const uEntry = gu(id);
    const prev = uEntry.label;
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
      const value = (name.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!commit || !value || value === prev) { name.textContent = prev; return; }
      if (node.fm?.name) node.fm.name = value; else node.label = value;
      uEntry.label = value;
      ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory(); ctx.hooks.persist();
      if (spec.stage) { renderStageGroup(undefined); focusDim(); renderTree(); renderInspector(); }
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
    const node = ctx.state.nodes[id];
    if (!node) return;
    fmEditor.renderFrontmatterSection(host, node);
    host.addEventListener('change', () => {
      build();
      computeBlast();
      renderCanvas();
      focusDim();
      renderTree();
      setTimeout(spec.stage ? drawStageWires : drawWires, 0);
    });
  }

  /* ================= HIDDEN MODEL VERBS (M5 A-verbs) =================
     Unfold is a read-only surface for every model verb except rename and
     frontmatter until this section: overlay-scoped keyboard shortcuts + a
     selection-only '⋯' actions menu, both gated by the pure ufVerbAllowed
     so an impossible verb (paste with an empty clipboard, edge ops with no
     wire) can never be offered. Every verb bridges unfold's own selection
     to the shared model selection first (deps.selection.selectOnly /
     selectEdge), invokes the single-owner module verb (nodes / clipboard /
     history — never an inline mutation here), then rebuilds the universe
     via the refreshFromModel path (the io/mermaid apply precedent) and
     re-seeds unfold's selection from whatever the verb left selected in
     the shared model (selectSync('open') — the same reverse-bridge used
     entering unfold). */
  const verbState = (): { sel: string | null; wire: boolean; clipboard: boolean; modelEmpty: boolean } => ({
    sel: spec.sel || null,
    wire: !!spec.selWire,
    clipboard: ctx.clipboard.nodes.length > 0,
    modelEmpty: Object.keys(ctx.state.nodes).length === 0,
  });
  /** after a module verb mutates ctx.state: rebuild the derived units + full
      repaint, then re-seed unfold's selection from ctx.state.sel (empty for
      delete/clearAll, the pasted/duplicated/added set otherwise). */
  function rebuildAfterVerb(): void {
    refreshFromModel();
    selectSync('open');
    render(true);
  }
  /** the real DiagramEdge behind the rendered wire pair. A direct pair
      between two real nodes resolves (state.edges forbids a duplicate
      same-direction pair, so at most one match exists); a lifted pair
      spanning a container boundary has no single real edge and correctly
      resolves to null — the caller's gate then has nothing to act on. */
  function resolveSelWireEdgeId(): string | null {
    if (!spec.selWire) return null;
    const { a: nodeA, b: nodeB } = spec.selWire;
    const foundEdge = ctx.state.edges.find((x) => (x.from === nodeA && x.to === nodeB) || (x.from === nodeB && x.to === nodeA));
    return foundEdge ? foundEdge.id : null;
  }

  /* ---- connect mode: the one two-step verb ---- */
  let connectFrom: string | null = null;
  function armConnect(): void {
    if (!spec.sel) return;
    connectFrom = spec.sel;
    overlay.classList.add('uf-connecting');
    const scope: HTMLElement = spec.stage ? stageLayer : contentEl;
    scope.querySelector(`[data-id="${window.CSS.escape(spec.sel)}"]`)?.classList.add('uf-armed');
  }
  function cancelConnect(): void {
    if (connectFrom) {
      overlay.querySelectorAll(`[data-id="${window.CSS.escape(connectFrom)}"]`).forEach((el) => el.classList.remove('uf-armed'));
    }
    connectFrom = null;
    overlay.classList.remove('uf-connecting');
  }
  function completeConnect(targetId: string): void {
    const src = connectFrom;
    cancelConnect();
    if (!src || src === targetId) return;
    deps.selection.selectOnly(src);
    deps.nodes.makeEdge(src, targetId);
    rebuildAfterVerb();
  }

  /** a %% group hierarchy container (unfold's synthetic reading-only region) is a
      valid selection SHAPE for the gate but not a real model node — the node
      verbs (duplicate/copy/wrap/connect) need an actual ctx.state.nodes entry
      to bridge into, so they additionally require this before acting. */
  const selIsRealNode = (): boolean => !!(spec.sel && ctx.state.nodes[spec.sel]);

  /** single dispatch point for every hidden model verb — shortcuts and the
      '⋯' menu both funnel through here so the gate is checked exactly once
      per invocation regardless of the surface that triggered it. */
  /** shared shape of edgeReverse/edgeDelete: resolve the real edge behind the
      selected wire, sync the shared selection onto it, then apply the verb */
  function invokeEdgeVerb(action: (id: string) => void): void {
    const id = resolveSelWireEdgeId();
    if (!id) return;
    deps.selection.selectEdge(id);
    action(id);
    rebuildAfterVerb();
  }
  /** delete: a selected wire deletes its real edge, a selected node deletes the
      node — the reducer's mutual exclusion means exactly one of the two holds */
  function verbDelete(): void {
    if (spec.selWire) {
      const id = resolveSelWireEdgeId();
      if (!id) return;
      deps.selection.selectEdge(id);
      deps.nodes.deleteEdge(id);
    } else if (spec.sel) {
      deps.selection.selectOnly(spec.sel);
      deps.nodes.deleteSelection();
    } else return;
    rebuildAfterVerb();
  }
  /** create a bare node and land on it — reveal + select, in one step */
  function verbAddNode(): void {
    const id = deps.nodes.addNode('rect', null, null, {});
    build();
    goTo(id); // reveal + select the new node in unfold
  }
  function invokeVerb(verb: string): void {
    const verbCtx = verbState();
    if (!ufVerbAllowed(verb, verbCtx)) return;
    switch (verb) {
      case 'addNode':
        verbAddNode();
        return;
      case 'connect':
        if (!selIsRealNode()) return;
        armConnect();
        return;
      case 'duplicate':
        if (!selIsRealNode()) return;
        deps.selection.selectOnly(spec.sel);
        deps.clipboard.duplicateSel();
        rebuildAfterVerb();
        return;
      case 'copy':
        if (!selIsRealNode()) return;
        deps.selection.selectOnly(spec.sel);
        deps.clipboard.copySel(); // clipboard-only change — nothing to rebuild
        return;
      case 'paste':
        // assumption (2): unfold has no pointer-world yet — paste at the model default
        deps.clipboard.pasteClip(null);
        rebuildAfterVerb();
        return;
      case 'wrap':
        if (!selIsRealNode()) return;
        deps.selection.selectOnly(spec.sel);
        deps.nodes.wrapInGroup(); // single-selection wrap is legal (assumption 3)
        rebuildAfterVerb();
        return;
      case 'editMeta':
      case 'edgeLabel':
        return; // inline menu rows commit directly — not a single-shot action
      case 'edgeReverse':
        invokeEdgeVerb((id) => deps.nodes.reverseEdge(id));
        return;
      case 'edgeDelete':
        invokeEdgeVerb((id) => deps.nodes.deleteEdge(id));
        return;
      case 'delete':
        verbDelete();
        return;
      case 'clearAll':
        if (!confirm('Clear the whole canvas?')) return; // assumption (6): confirm stays at the caller
        deps.nodes.clearAll();
        rebuildAfterVerb();
        return;
      case 'undo':
        deps.history.undo();
        rebuildAfterVerb();
        return;
      case 'redo':
        deps.history.redo();
        rebuildAfterVerb();
        return;
    }
  }

  /* ---- the selection-only '⋯' actions menu ---- */
  let actionsMenuOpen = false;
  function closeActionsMenu(): void {
    if (!actionsMenuOpen) return;
    actionsMenuOpen = false;
    renderInspector();
  }
  const VERB_LABELS: Record<string, string> = {
    addNode: 'add node', connect: 'connect', duplicate: 'duplicate', copy: 'copy', paste: 'paste',
    wrap: 'wrap in group', edgeReverse: 'edge reverse', edgeDelete: 'edge delete', delete: 'delete',
    clearAll: 'clear all', undo: 'undo', redo: 'redo',
  };
  function buildActionsMenu(): HTMLElement {
    const verbCtx = verbState();
    const wrap = h('div', 'uf-menu');
    const NEEDS_REAL_NODE = new Set(['connect', 'duplicate', 'copy', 'wrap']);
    const item = (verb: string, danger?: boolean): void => {
      if (!ufVerbAllowed(verb, verbCtx)) return;
      if (NEEDS_REAL_NODE.has(verb) && !selIsRealNode()) return; // a %% hier group has no model node to bridge into
      const btn = h('button', 'uf-mitem' + (danger ? ' danger' : ''), esc(VERB_LABELS[verb]));
      btn.onclick = (ev) => { ev.stopPropagation(); closeActionsMenu(); invokeVerb(verb); };
      wrap.appendChild(btn);
    };
    item('addNode');
    item('connect');
    item('duplicate');
    item('copy');
    item('paste');
    item('wrap');
    if (ufVerbAllowed('editMeta', verbCtx) && spec.sel && ctx.state.nodes[spec.sel]) {
      wrap.appendChild(buildEditMetaRow(spec.sel));
    }
    const wireEdgeId = ufVerbAllowed('edgeLabel', verbCtx) ? resolveSelWireEdgeId() : null;
    if (wireEdgeId) wrap.appendChild(buildEdgeLabelRow(wireEdgeId));
    item('edgeReverse');
    item('edgeDelete', true);
    item('delete', true);
    item('clearAll', true);
    item('undo');
    item('redo');
    return wrap;
  }
  /** inline kind + description editor, committing on change/Enter (never a prompt/alert) */
  function buildEditMetaRow(id: string): HTMLElement {
    const node = ctx.state.nodes[id];
    const row = h('div', 'uf-mrow');
    const kindSel = document.createElement('select');
    kindSel.className = 'uf-minput';
    kindSel.innerHTML = '<option value="">(none)</option>'
      + KINDS.map((k) => `<option value="${k}">${esc(k)}</option>`).join('');
    kindSel.value = node.kind ?? '';
    kindSel.onchange = () => {
      const kindValue = kindSel.value;
      closeActionsMenu();
      deps.selection.selectOnly(id);
      deps.nodes.setNodeMeta(id, { kind: kindValue ? (kindValue as NodeKind) : null });
      rebuildAfterVerb();
    };
    const descInp = document.createElement('input');
    descInp.className = 'uf-minput';
    descInp.placeholder = 'description';
    descInp.value = node.fm?.description ?? '';
    const commitDesc = (): void => {
      const descValue = descInp.value;
      closeActionsMenu();
      deps.selection.selectOnly(id);
      deps.nodes.setNodeMeta(id, { desc: descValue });
      rebuildAfterVerb();
    };
    descInp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commitDesc(); } };
    descInp.onchange = commitDesc;
    row.appendChild(kindSel);
    row.appendChild(descInp);
    return row;
  }
  /** inline edge-label editor, committing on change/Enter */
  function buildEdgeLabelRow(edgeId: string): HTMLElement {
    const edge = ctx.state.edges.find((x) => x.id === edgeId);
    const row = h('div', 'uf-mrow');
    const labelInp = document.createElement('input');
    labelInp.className = 'uf-minput';
    labelInp.placeholder = 'edge label';
    labelInp.value = edge?.label ?? '';
    const commitLabel = (): void => {
      const value = labelInp.value;
      closeActionsMenu();
      deps.selection.selectEdge(edgeId);
      deps.nodes.setEdgeLabel(edgeId, value);
      rebuildAfterVerb();
    };
    labelInp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commitLabel(); } };
    labelInp.onchange = commitLabel;
    row.appendChild(labelInp);
    return row;
  }

  /* ================= ORCHESTRATION ================= */
  let firstFit = true;
  function render(refit: boolean): void {
    // (the U2 wire-dies-with-its-reps rule moved into reduceView — render is a
    // pure CONSUMER of the spec; its only other inputs are animation/camera infra)
    computeBlast();
    renderCanvas();
    enterStagger();
    focusDim();
    renderTree();
    renderInspector();
    refreshStage();   // U4: the stage projection subscribes to the same view state as the canvas
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
    commit({ type: 'toggleExpand', id });
  }
  /** U6: a group is a first-class selectable — select + inspect, never stage (U8 deferred to stage 5).
      The sel/selWire/focusType/fmOpen exclusions live in the reducer; the staged /
      blast / plain repaints live in paint('select'). */
  function selectGroup(id: string): void {
    commit({ type: 'select', id });
  }
  function select(id: string): void {
    const wasStaged = !!spec.stage;
    selectGroup(id);
    if (wasStaged || spec.layers.blast) return;
    // approved stage entry: selecting a card projects its GROUP center-stage;
    // a top-level container card (a module) IS the group — project it directly
    const selNode = spec.sel ? U.get(spec.sel) : undefined;
    if (selNode && selNode.parent && isContainer(U.get(selNode.parent))) stageMode(selNode.parent);
    else if (selNode && !selNode.parent && isContainer(selNode)) stageMode(selNode.id);
  }
  function foldAll(): void {
    (q('ufSearch') as HTMLInputElement).value = '';
    commit({ type: 'foldAll' });
  }

  /* ================= TREE ================= */
  function renderTree(): void {
    const treeEl = q('ufTree');
    treeEl.innerHTML = '';
    for (const rid of ROOTS) treeEl.appendChild(treeRow(rid));
    if (spec.query) filterTree();
  }
  function treeRow(id: string): HTMLElement {
    const u = gu(id), wrap = h('div');
    const canOpen = isContainer(u), on = isRendered(id) && !spec.hidden.includes(id), isOpen = spec.expanded.includes(id);
    const row = h('div', 'uf-trow ' + (canOpen ? '' : 'leaf ') + (on ? 'on ' : '') + (isOpen ? 'open ' : '') + (spec.sel === id ? 'sel' : ''));
    row.dataset.id = id;
    row.innerHTML = `<span class="uf-ttw">${canOpen ? '<svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg>' : ''}</span>
      <span class="uf-tlabel">${esc(u.label)}</span>
      <span class="uf-tchk" title="Show / hide on canvas"></span>`;
    (row.querySelector('.uf-ttw') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      if (!canOpen) return;
      apply({ type: 'reveal', id });
      commit({ type: 'toggleExpand', id });
    };
    (row.querySelector('.uf-tchk') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      commit({ type: isRendered(id) && !spec.hidden.includes(id) ? 'hide' : 'reveal', id });
    };
    (row.querySelector('.uf-tlabel') as HTMLElement).onclick = (e) => {
      e.stopPropagation(); goTo(id);
    };
    wrap.appendChild(row);
    if (canOpen) {
      const kids = h('div', 'uf-tkids' + (isOpen ? ' open' : ''));
      for (const c of u.children) kids.appendChild(treeRow(c));
      wrap.appendChild(kids);
    }
    return wrap;
  }
  function filterTree(): void {
    const hits = new Set<string>();
    for (const node of U.values()) {
      if (node.label.toLowerCase().includes(spec.query) || node.desc.toLowerCase().includes(spec.query)) {
        let x: UNode | undefined = node;
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
  /** U6: external connections of a container — every edge with exactly one endpoint
      inside the subtree, aggregated to the coarsest foreign container and weight-summed
      (the same grammar as stage pills: frame = subtree + ancestors, so a sibling stays
      itself and a foreign subtree compresses into its top group) */
  function groupConns(id: string): { uses: [string, number][]; usedBy: [string, number][] } {
    const sub = new Set<string>();
    (function walk(x: string): void {
      if (sub.has(x)) return;
      sub.add(x);
      (U.get(x)?.children ?? []).forEach(walk);
    })(id);
    const frame = new Set(sub);
    let cur = U.get(id);
    const seen = new Set<string>();
    while (cur && cur.parent && !seen.has(cur.id)) { seen.add(cur.id); frame.add(cur.parent); cur = U.get(cur.parent); }
    const uses = new Map<string, number>(), usedBy = new Map<string, number>();
    for (const edge of EDGES) {
      const fi = sub.has(edge.from), ti = sub.has(edge.to);
      if (fi === ti) continue;
      const bucket = fi ? uses : usedBy;
      const other = proxyTargetOf(fi ? edge.to : edge.from, frame);
      bucket.set(other, (bucket.get(other) ?? 0) + edge.w);
    }
    const byWeight = (m: Map<string, number>): [string, number][] =>
      [...m.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    return { uses: byWeight(uses), usedBy: byWeight(usedBy) };
  }

  /** every [data-goto] anchor inside a just-painted inspector block routes through goTo */
  function wireGotoLinks(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>('[data-goto]').forEach((r) => {
      r.onclick = () => goTo(r.dataset.goto as string);
    });
  }
  /** the '⋯' actions-menu toggle + its mounted panel — shared by the wire and node inspectors */
  function wireActionsMenu(el: HTMLElement): void {
    const menuBtn = el.querySelector('#ufIMenu') as HTMLElement | null;
    if (menuBtn) menuBtn.onclick = (ev) => { ev.stopPropagation(); actionsMenuOpen = !actionsMenuOpen; renderInspector(); };
    const menuHost = el.querySelector('#ufActionsMenu') as HTMLElement | null;
    if (menuHost) menuHost.appendChild(buildActionsMenu());
  }
  /** U1: focused-type inspector — every carrier of the clicked type name */
  function renderTypeFocusInspector(el: HTMLElement, t: string): void {
    const carriers = [...U.keys()].filter((id) => carriesType(id, t));
    el.innerHTML = `<div class="uf-ihead">
      <span class="uf-ikind">type</span>
      <div class="uf-iname uf-mono">${esc(t)}</div>
    </div>
    <div class="uf-blk"><div class="uf-ilab2">carried by (${carriers.length})</div>
    ${carriers.map((id) =>
      `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">·</span><span class="uf-cn">${esc(U.get(id)?.label ?? id)}</span></div>`).join('')}
    </div>`;
    wireGotoLinks(el);
  }
  /** the rendered rep pair's underlying model edges: in explore this is the same pure lift
      the painter draws (neutral pass, unordered anchor match); staged keeps its own rep
      aggregation (untouched by P-wires) */
  function computeWireUnderlying(a: string, b: string): UEdge[] {
    if (spec.stage) {
      return EDGES.filter((e) =>
        ((e.call && spec.layers.calls) || (e.dep && spec.layers.deps)) && stageRepOf(e.from) === a && stageRepOf(e.to) === b);
    }
    const lifted = computeLifted(true).find((w2) => (w2.a === a && w2.b === b) || (w2.a === b && w2.b === a));
    return (lifted?.underlying ?? [])
      .map((u2) => EDGES.find((e) => e.from === u2.from && e.to === u2.to))
      .filter((e): e is UEdge => !!e);
  }
  /** U2: the selected wire is an information object — endpoints, kind, direction,
      weight, and every underlying model relation it aggregates (legacy-editor parity) */
  function renderWireInspector(el: HTMLElement, a: string, b: string): void {
    const ua = gu(a), ub = gu(b);
    const unders = computeWireUnderlying(a, b);
    if (!unders.length) {
      // the aggregate no longer exists in this projection — drop the selection through the reducer
      apply({ type: 'selectWire', a, b });
      el.innerHTML = '';
      return;
    }
    const weight = unders.reduce((s, e) => s + e.w, 0);
    const kinds = [unders.some((e) => e.call) ? 'call' : '', unders.some((e) => e.dep) ? 'dependency' : '']
      .filter(Boolean).join(' + ') || 'wire';
    const ep = (id: string, arrow: string, tag: string): string =>
      `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${arrow}</span><span class="uf-cn">${esc(U.get(id)?.label ?? id)}</span><span class="uf-cl">${tag}</span></div>`;
    el.innerHTML = `<div class="uf-ihead">
      <span class="uf-ikind">wire</span>
      <div class="uf-iname">${esc(ua.label)} → ${esc(ub.label)}</div>
      <div class="uf-idesc">${esc(kinds)} · weight ${weight}</div>
      <div class="uf-iact"><button class="uf-ibtn" id="ufIMenu" title="Actions">⋯</button></div>
    </div>
    ${actionsMenuOpen ? '<div class="uf-blk" id="ufActionsMenu"></div>' : ''}
    <div class="uf-blk"><div class="uf-ilab2">endpoints</div>${ep(a, '→', 'from')}${ep(b, '←', 'to')}</div>
    ${unders.length ? `<div class="uf-blk"><div class="uf-ilab2">carries (${unders.length})</div>` + unders.map((e) => {
      const adv = spec.layers.trust && ALLOW.has(e.from + '->' + e.to);
      const chips = (e.label ? `<span class="uf-cl">${esc(e.label.split(',')[0])}</span>` : '')
        + (adv ? '<span class="uf-cl adv">advisory</span>' : '')
        + `<span class="uf-cl">${e.call && e.dep ? 'call · dep' : e.call ? 'call' : 'dep'}</span>`;
      return `<div class="uf-conn" data-goto="${esc(e.to)}"><span class="uf-arw">${e.dep && !e.call ? '⇢' : '→'}</span><span class="uf-cn">${esc(U.get(e.from)?.label ?? e.from)} → ${esc(U.get(e.to)?.label ?? e.to)}</span>${chips}</div>`;
    }).join('') + '</div>' : ''}`;
    wireGotoLinks(el);
    wireActionsMenu(el);
  }
  /** U6: a container's role is derived — member-kind breakdown + total descendants
      (hier groups carry only a label; the breakdown is the honest substitute for a desc) */
  function buildContainerRoleHtml(u: UNode): string {
    const byKind = new Map<string, number>();
    for (const childId of u.children) {
      const k = gu(childId).kind;
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    let total = -1;
    (function count(x: string): void { total++; (U.get(x)?.children ?? []).forEach(count); })(u.id);
    const parts = [...byKind.entries()].sort((x, y) => y[1] - x[1])
      .map(([k, n2]) => `${n2} ${k}${n2 === 1 ? '' : 's'}`);
    return `<div class="uf-idesc">${esc(parts.join(' · '))}${total > u.children.length ? esc(` · ${total} total inside`) : ''}</div>`;
  }
  /** U6: a container's members + subtree-aggregated external connections, or (for a
      leaf) its direct model connections — the two connection shapes the inspector shows */
  function buildInspectorConnectionsHtml(u: UNode, canOpen: boolean): string {
    if (canOpen) {
      // U6: group-level information — direct members, then subtree-aggregated external connections
      const members = u.children.map((c) => {
        const uc = gu(c);
        const tag = isContainer(uc) ? `${uc.children.length} inside` : uc.kind;
        return `<div class="uf-conn" data-goto="${esc(c)}"><span class="uf-arw">·</span><span class="uf-cn">${esc(uc.label)}</span><span class="uf-cl">${esc(tag)}</span></div>`;
      }).join('');
      const gc = groupConns(u.id);
      const aggBlk = (title: string, arrow: string, arr: [string, number][]): string =>
        !arr.length ? '' : `<div class="uf-blk"><div class="uf-ilab2">${title} (${arr.length})</div>`
          + arr.map(([tid, w2]) =>
            `<div class="uf-conn" data-goto="${esc(tid)}"><span class="uf-arw">${arrow}</span><span class="uf-cn">${esc(U.get(tid)?.label ?? tid)}</span><span class="uf-cl">×${w2}</span></div>`).join('')
          + '</div>';
      return `<div class="uf-blk"><div class="uf-ilab2">contains (${u.children.length})</div>${members}</div>`
        + aggBlk('uses →', '→', gc.uses) + aggBlk('← used by', '←', gc.usedBy);
    }
    const conns = (arr: UEdge[], key: 'from' | 'to', title: string, arrow: string): string => {
      const seen = new Map<string, string>();
      for (const edge of arr) if (!seen.has(edge[key])) seen.set(edge[key], edge.label);
      if (!seen.size) return '';
      return `<div class="uf-blk"><div class="uf-ilab2">${title} (${seen.size})</div>`
        + [...seen.entries()].map(([id, lbl]) => {
          const adv = spec.layers.trust && ALLOW.has(key === 'to' ? u.id + '->' + id : id + '->' + u.id);
          const chip = adv ? '<span class="uf-cl adv">advisory</span>'
            : lbl ? `<span class="uf-cl">${esc(lbl.split(',')[0])}</span>` : '';
          return `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${arrow}</span><span class="uf-cn">${esc(U.get(id)?.label ?? id)}</span>${chip}</div>`;
        }).join('')
        + '</div>';
    };
    return conns(OUT[u.id] ?? [], 'to', 'uses →', '→') + conns(IN[u.id] ?? [], 'from', '← used by', '←');
  }
  /** DOM wiring for the node inspector: every button/host the just-painted html contains */
  function wireNodeInspectorControls(el: HTMLElement, u: UNode): void {
    const io = el.querySelector('#ufIOpen') as HTMLElement | null;
    if (io) io.onclick = () => toggleExpand(u.id);
    const ie = el.querySelector('#ufIEdit') as HTMLElement | null;
    if (ie) ie.onclick = () => commit({ type: 'setFmOpen', open: !spec.fmOpen });
    const fmHost = el.querySelector('#ufFmHost') as HTMLElement | null;
    if (fmHost) mountFrontmatter(fmHost, u.id);
    const ih = el.querySelector('#ufIHide') as HTMLElement | null;
    if (ih) ih.onclick = () => commit({ type: 'hide', id: u.id });
    const is2 = el.querySelector('#ufIShow') as HTMLElement | null;
    if (is2) is2.onclick = () => commit({ type: 'reveal', id: u.id });
    wireActionsMenu(el);
    wireGotoLinks(el);
  }
  /** the header's action-button row: unfold/fold, add/remove from view, edit frontmatter, the ⋯ menu */
  function buildInspectorActionsHtml(node: UNode, canOpen: boolean): string {
    return `<div class="uf-iact">
        ${canOpen ? `<button class="uf-ibtn pri" id="ufIOpen">${spec.expanded.includes(node.id) ? 'fold' : 'unfold'}</button>` : ''}
        ${isRendered(node.id)
          ? `<button class="uf-ibtn" id="ufIHide">remove from view</button>`
          : `<button class="uf-ibtn" id="ufIShow">add to view</button>`}
        ${ctx.state.nodes[node.id] ? `<button class="uf-ibtn${spec.fmOpen ? ' pri' : ''}" id="ufIEdit">${spec.fmOpen ? 'done' : 'edit'}</button>` : ''}
        <button class="uf-ibtn" id="ufIMenu" title="Actions">⋯</button>
      </div>`;
  }
  /** the inspector header block: kind chip, name, breadcrumbs, role/desc, action buttons */
  function buildInspectorHeaderHtml(node: UNode): string {
    const isSym = SYM_KINDS.has(node.kind);
    const canOpen = isContainer(node);
    const crumbs = ancestorCrumbs(node);
    const role = canOpen ? buildContainerRoleHtml(node) : '';
    return `<div class="uf-ihead">
      <span class="uf-ikind">${esc(node.kind)}</span>
      <div class="uf-iname${isSym ? ' uf-mono' : ''}">${esc(node.label)}</div>
      ${crumbs.length ? `<div class="uf-ipath">${esc(crumbs.join('  ›  '))}</div>` : ''}
      ${node.desc ? `<div class="uf-idesc">${esc(node.desc)}</div>` : ''}${role}
      ${buildInspectorActionsHtml(node, canOpen)}
    </div>
    ${spec.fmOpen && ctx.state.nodes[node.id] ? '<div class="uf-blk" id="ufFmHost"></div>' : ''}
    ${actionsMenuOpen ? '<div class="uf-blk" id="ufActionsMenu"></div>' : ''}`;
  }
  /** the inspector's fixed-fact blocks: accepts/returns/state, then blast radius if that layer is on */
  function buildInspectorFactsHtml(node: UNode): string {
    const blk = (label: string, vals: string[]): string =>
      vals.length ? `<div class="uf-blk"><div class="uf-ilab2">${label}</div>${vals.map((v) => `<div class="uf-iline">${ifaceLine(v)}</div>`).join('')}</div>` : '';
    let html = blk('accepts', node.accepts) + blk('returns', node.returns) + blk('state', node.state);
    if (spec.layers.blast) {
      html += `<div class="uf-blk"><div class="uf-ilab2">blast radius</div><div class="uf-iline">${BLAST_N} transitive dependent${BLAST_N === 1 ? '' : 's'}</div></div>`;
    }
    return html;
  }
  /** the inspector's source block: the loaded function body for this node, if any */
  function buildInspectorSourceHtml(node: UNode): string {
    const body = (ctx.bodies?.get(node.id) as { body?: string } | undefined)?.body;
    return body ? `<div class="uf-blk"><div class="uf-ilab2">source</div><div class="uf-body"><pre>${esc(body)}</pre></div></div>` : '';
  }
  /** the node inspector: header + role + fixed facts + connections, then wire every control */
  function renderNodeInspector(el: HTMLElement): void {
    if (!spec.sel || !U.has(spec.sel)) { el.innerHTML = ''; return; }
    const node = gu(spec.sel);
    const canOpen = isContainer(node);
    let html = buildInspectorHeaderHtml(node);
    html += buildInspectorFactsHtml(node);
    html += buildInspectorConnectionsHtml(node, canOpen);
    html += buildInspectorSourceHtml(node);
    el.innerHTML = html;
    wireNodeInspectorControls(el, node);
  }
  // the inspector: empty until a selection exists, else one of three shapes
  // (type focus, wire, or node) — each a dedicated render + wire-up pair above
  function renderInspector(): void {
    const el = q('ufInsp');
    if (spec.focusType) { renderTypeFocusInspector(el, spec.focusType); return; }
    if (spec.selWire && U.has(spec.selWire.a) && U.has(spec.selWire.b)) {
      renderWireInspector(el, spec.selWire.a, spec.selWire.b);
      return;
    }
    renderNodeInspector(el);
  }

  /* ================= LAYERS ================= */
  function renderLayers(): void {
    const bx = q('ufLayers');
    bx.innerHTML = '';
    for (const layerDef of LAYER_DEFS) {
      const noSrc = layerDef.k === 'trust' && !TRUST_SRC;
      const row = h('div', 'uf-layer' + (spec.layers[layerDef.k] ? ' on' : '') + (noSrc ? ' off' : ''),
        `<span class="uf-sw"></span><span style="flex:1;min-width:0"><div class="uf-lt">${layerDef.label}</div><div class="uf-ld">${layerDef.desc}</div></span>`
        + (noSrc ? '<button class="uf-load" title="Load an edge-advisory-allowlist.txt">load…</button>' : ''));
      if (noSrc) {
        // no advisory source = the layer stays off (it never marks what it cannot back)
        row.onclick = (ev) => {
          if ((ev.target as HTMLElement).closest('.uf-load')) { ev.stopPropagation(); trustFileEl.click(); }
        };
      } else {
        row.onclick = () => commit({ type: 'toggleLayer', key: layerDef.k });
      }
      bx.appendChild(row);
    }
  }
  function applyLayerClasses(): void {
    overlay.classList.toggle('desc', spec.layers.desc);
    overlay.classList.toggle('iface', spec.layers.iface);
    overlay.classList.toggle('metrics', spec.layers.metrics);
    overlay.classList.toggle('color', spec.layers.color);
    overlay.classList.toggle('trust', spec.layers.trust);
  }

  /* ================= CHROME-LESS CONTROLS ================= */
  q('ufZin').onclick = () => { viewXform.k = Math.min(2.5, viewXform.k * 1.15); clampPan(); setT(true); };
  q('ufZout').onclick = () => { viewXform.k = Math.max(.15, viewXform.k / 1.15); clampPan(); setT(true); };
  q('ufZfit').onclick = () => fitView(true);
  q('ufFold').onclick = foldAll;
  function applyDark(dark: boolean): void {
    overlay.classList.toggle('dark', dark);
    q('ufThemeIc').innerHTML = dark
      ? '<circle cx="8" cy="8" r="3.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"/>'
      : '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z"/>';
    localStorage.setItem('unfold.theme', dark ? 'dark' : 'light');
    q('ufStyleDark').classList.toggle('on', dark);
    drawWires();
  }
  q('ufTheme').onclick = () => applyDark(!overlay.classList.contains('dark'));
  (q('ufSearch') as HTMLInputElement).oninput = (e) => {
    commit({ type: 'setQuery', q: (e.target as HTMLInputElement).value.trim().toLowerCase() });
  };
  /** Enter renames the selected card in place — but never while typing in a field */
  function handleEnterKey(ev: KeyboardEvent, inAnyField: boolean): void {
    if (!inAnyField && spec.sel && !spec.focusType) { ev.stopPropagation(); renameInPlace(spec.sel); }
  }
  /** overlay-scoped model-verb shortcuts (M5 A-verbs) — suppressed while typing in a
      field (criterion 8); stopPropagation so the legacy document-level keyboard.ts
      handler never ALSO fires the same verb a second time */
  function handleVerbShortcut(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('delete'); return; }
    if (mod && ev.shiftKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('redo'); return; }
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('undo'); return; }
    if (mod && ev.key.toLowerCase() === 'c') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('copy'); return; }
    if (mod && ev.key.toLowerCase() === 'v') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('paste'); return; }
    if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('duplicate'); return; }
  }
  /** Escape dispatch: the pure ufEscAction decides which layer of state to peel back */
  function handleEscapeKey(ev: KeyboardEvent, target: HTMLElement, inAnyField: boolean): void {
    // a rename in flight or a frontmatter field owns its own Escape; the search box keeps the old chain
    if (target.isContentEditable || (inAnyField && target.id !== 'ufSearch')) return;
    ev.stopPropagation();
    const act = ufEscAction({
      connect: !!connectFrom,
      focusType: !!spec.focusType, selWire: !!spec.selWire, stage: !!spec.stage,
      sel: !!spec.sel, query: !!spec.query,
    });
    if (act === 'cancelConnect') { cancelConnect(); }
    else if (act === 'clearTypeFocus') { typeFocus(null); }
    else if (act === 'deselectWire') { commit({ type: 'selectWire', a: spec.selWire!.a, b: spec.selWire!.b }); }
    else if (act === 'exitStage') { setSel(null); stageMode(null); renderInspector(); setTimeout(drawWires, 0); }
    else if (act === 'selectGroup') { selectGroup(spec.sel!); }
    else if (act === 'clearQuery') { (q('ufSearch') as HTMLInputElement).value = ''; commit({ type: 'setQuery', q: '' }); }
    // 'none': nothing to clear — Escape never exits unfold
  }
  document.addEventListener('keydown', (e) => {
    if (!overlay.classList.contains('show')) return;
    const targetEl = e.target as HTMLElement;
    const inAnyField = targetEl.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName);
    if (e.key === 'Enter') { handleEnterKey(e, inAnyField); return; }
    if (!inAnyField) handleVerbShortcut(e);
    if (e.key !== 'Escape') return;
    handleEscapeKey(e, targetEl, inAnyField);
  }, true);

  /* ================= API ================= */
  trustLayer();
  function open(): void {
    applyDark(localStorage.getItem('unfold.theme') === 'dark');
    build();
    persistView('load');   // resets sel/stage/focusType/fmOpen; restores the durable trio
    selectSync('open');
    prevShown = new Set();
    wiresEverDrawn = new Set();
    wireEnterAt = 0;
    overlay.classList.remove('staged');
    renderStageGroup(undefined);   // clears any stage-layer remnants from the last session
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
  // the ONLY route out of unfold: the explicit legacy-compare affordance
  // (temporary — dies with the canvas at M5 parity); Esc never lands here
  q('ufCompare').onclick = () => closeFn();
  return {
    open,
    close: closeFn,
    toggle: () => (overlay.classList.contains('show') ? closeFn() : open()),
  };
}
