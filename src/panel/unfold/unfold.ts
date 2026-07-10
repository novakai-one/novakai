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

   Containment: a node's live `parent` wins; otherwise the novakai drill
   convention applies — an id `mod__rest` folds under node `mod` when that
   node exists. Generic diagrams fold by their real containment only.

   ---------------------------------------------------------------------
   In-place reorg note: this file used to hold ~90 closures directly
   inside initUnfold, all sharing initUnfold's local variables (U, spec,
   viewXform, …). Those units are now split across sibling files
   (unfold-view[-2], unfold-wires, unfold-inspect[-2], unfold-session[-2],
   unfold-stage[-2]); initUnfold's exported shape (UnfoldApi) is
   unchanged. The mechanism that lets a moved unit still reach
   initUnfold's locals without altering its own statements is the shared
   `E: UEnv` object below: every initUnfold local that a moved unit reads
   or writes is a property of `E`, constructed once here and passed by
   reference into every sibling factory. A factory attaches the functions
   it defines back onto `E` (`E.build = build`) so later-called factories
   — and unfold.ts itself — can call them; since those calls only ever
   happen inside deferred closures (event handlers, setTimeout, or calls
   made after every factory has run), the ORDER the factories are called
   in below does not matter for correctness.

   The env (`E` above) is assembled by the small `create*` helpers below
   rather than field-by-field inside initUnfold: each helper builds one
   slice (DOM refs, empty model, initial scalars) and initUnfold's own
   body is just import → build overlay → assemble env → wire the sibling
   factories → return the API, unchanged end-to-end behaviour, just
   named in pieces instead of one long procedure.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import type { SelectionApi } from '../../interaction/selection';
import type { CameraApi } from '../../core/camera/camera';
import type { ViewSpec, ViewAction, ViewModelIndex } from '../../core/viewspec/viewspec';
import { emptyViewSpec } from '../../core/viewspec/viewspec';
import type { LiftedWire } from './unfold-lift';
import type { DockAction } from './unfold-dock';
import type { FilesApi } from '../../io/files';
import type { MermaidApi } from '../../io/mermaid';
import type { SliceApi } from '../nav/slice';
import type { ThemingApi } from '../style/theming';
import type { NodesApi } from '../../interaction/nodes';
import type { ClipboardApi } from '../../interaction/clipboard';
import type { HistoryApi } from '../../core/history/history';
import { UNFOLD_CSS } from './unfold-view-2';
import { initUnfoldView } from './unfold-view';
import { initUnfoldWires } from './unfold-wires';
import { initUnfoldInspect } from './unfold-inspect';
import { initUnfoldInspect2 } from './unfold-inspect-2';
import { initUnfoldSession } from './unfold-session';
import { initUnfoldSession2 } from './unfold-session-2';
import { initUnfoldStage } from './unfold-stage';
import { initUnfoldStage2 } from './unfold-stage-2';

export interface UnfoldApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** rebuild + repaint from ctx.state if currently shown; no-op otherwise (W1: the
      planner overlay wires this to its close path so unfold isn't stale on return) */
  refreshFromModel: () => void;
}

/* ---- folded-view unit (derived from ctx.state on every open) ---- */
export interface UNode {
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
export interface UEdge { from: string; to: string; label: string; call: boolean; dep: boolean; w: number }
export interface Box { x: number; y: number; w: number; h: number; cx: number; cy: number }

export interface UnfoldDeps {
  selection: SelectionApi; camera: CameraApi; files: FilesApi; mermaid: MermaidApi;
  slice: SliceApi; theming: ThemingApi; nodes: NodesApi; clipboard: ClipboardApi; history: HistoryApi;
}

/** The shared environment every unfold-*.ts sibling factory closes over, in place
    of initUnfold's former local variables. See the file-header note above. */
export interface UEnv {
  ctx: AppContext;
  deps: UnfoldDeps;
  overlay: HTMLElement;
  stageEl: HTMLElement;
  worldEl: HTMLElement;
  contentEl: HTMLElement;
  wiresEl: SVGSVGElement;
  stageLayer: HTMLElement;
  sWiresEl: SVGSVGElement;
  q: (id: string) => HTMLElement;
  h: (tag: string, cls?: string, html?: string) => HTMLElement;

  // model (mutated in place — never reassigned wholesale, so a plain shared reference suffices)
  U: Map<string, UNode>;
  ROOTS: string[];
  EDGES: UEdge[];
  OUT: Record<string, UEdge[]>;
  IN: Record<string, UEdge[]>;
  viewXform: { x: number; y: number; k: number };
  ALLOW: Set<string>;
  REP_HOPS: Map<string, number>;
  prevShown: Set<string>;
  wiresEverDrawn: Set<string>;

  // scalars reassigned across sibling boundaries — must be read/written as E.field
  // everywhere (both here and in the siblings) so every holder sees the same value
  spec: ViewSpec;
  connectFrom: string | null;
  actionsMenuOpen: boolean;
  firstFit: boolean;
  repaintAction: string;
  wireEnterAt: number;
  TRUST_SRC: boolean;
  trustFileEl: HTMLInputElement | null;

  // unfold-view.ts
  build: () => void;
  deepFreeze: (spec: ViewSpec) => ViewSpec;
  renderCanvas: () => void;
  cardEl: (u: UNode) => HTMLElement;
  gu: (id: string) => UNode;
  isContainer: (node: UNode | undefined) => boolean;
  hasAncestor: (id: string, anc: string) => boolean;
  ancestorCrumbs: (node: UNode) => string[];
  depthOf: (id: string) => number;
  isNeighbour: (a: string, b: string) => boolean;
  ifaceLine: (raw: string) => string;

  // unfold-wires.ts
  computeLifted: (neutral?: boolean) => LiftedWire[];
  drawWires: () => void;
  drawStageWires: () => void;

  // unfold-inspect.ts
  computeBlast: () => void;
  trustLayer: () => void;
  selectGroup: (id: string) => void;
  select: (id: string) => void;
  stageTargetOf: (u: UNode) => string | null;
  groupConns: (id: string) => { uses: [string, number][]; usedBy: [string, number][] };
  renderInspector: () => void;
  renderLayers: () => void;
  applyLayerClasses: () => void;

  // unfold-inspect-2.ts
  renderTree: () => void;
  applyDock: (reframe: boolean) => void;
  dockCommit: (a: DockAction, reframe?: boolean) => void;
  refreshFromModel: () => void;
  renderSliceTab: () => void;

  // unfold-session.ts
  modelIndex: () => ViewModelIndex;
  apply: (...actions: ViewAction[]) => void;
  commit: (action: ViewAction) => void;
  setSel: (id: string | null) => void;
  goTo: (id: string) => void;
  selectSync: (dir: 'open' | 'close') => void;
  persistView: (dir: 'save' | 'load') => void;
  isRendered: (id: string) => boolean;
  visibleRep: (id: string) => string | null;
  render: (refit: boolean, actionType?: string) => void;
  toggleExpand: (id: string) => void;
  foldAll: () => void;
  open: () => void;
  close: () => void;

  // unfold-session-2.ts
  renameInPlace: (id: string) => void;
  mountFrontmatter: (host: HTMLElement, id: string) => void;
  completeConnect: (targetId: string) => void;
  invokeVerb: (verb: string) => void;
  buildActionsMenu: () => HTMLElement;
  closeActionsMenu: () => void;

  // unfold-stage.ts
  contentSize: () => { width: number; height: number };
  fitView: (anim?: boolean) => void;
  clampPan: () => void;
  setT: (anim?: boolean) => void;
  reframeToFit: () => void;
  enterStagger: () => void;
  focusDim: () => void;
  typeFocus: (t: string | null) => void;
  stageMode: (gid: string | null) => void;
  renderStageGroup: (dirFrom?: number) => void;
  refreshStage: () => void;
  stageRepOf: (id: string) => string | null;
  stageFrameIds: () => Set<string>;
  proxyTargetOf: (outside: string, frame: Set<string>) => string;
  carriesType: (id: string, t: string) => boolean;

  // unfold-stage-2.ts
  applyDark: (dark: boolean) => void;
}

const UNFOLD_OVERLAY_HTML = `
    <div class="uf-stage" id="ufStage">
      <div class="uf-world" id="ufWorld">
        <svg class="uf-wires" id="ufWires"></svg>
        <div class="uf-content" id="ufContent"></div>
      </div>
      <div class="uf-dock">
        <button id="ufZin" title="Zoom in"><svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8"/></svg></button>
        <button id="ufZout" title="Zoom out"><svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg></button>
        <button id="ufZfit" title="Fit to view">
          <svg viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>
        </button>
        <span class="uf-gap"></span>
        <button id="ufFold" title="Fold everything">
          <svg viewBox="0 0 16 16">
            <path d="M8 2v5M8 9v5M3 8h10"/>
            <path d="M5.5 5.5 8 3l2.5 2.5"/>
            <path d="M5.5 10.5 8 13l2.5-2.5"/>
          </svg>
        </button>
        <button id="ufTheme" title="Light / dark">
          <svg viewBox="0 0 16 16" id="ufThemeIc"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z"/></svg>
        </button>
        <button id="ufCompare" class="uf-legacy"
          title="Compare with the legacy editor — temporary, removed at parity">legacy</button>
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
        <button class="uf-pcol" id="ufPcol" title="Collapse panel">
          <svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg>
        </button>
      </div>
      <div class="uf-pbody" id="ufBodyReveal">
        <div class="uf-sec"><div class="uf-secb" id="ufLayers" style="padding-top:12px"></div></div>
        <div class="uf-sec"><div class="uf-sech">browse <span class="uf-n" id="ufCount"></span></div>
          <div class="uf-secb">
            <input class="uf-search" id="ufSearch" placeholder="find…"><div id="ufTree"></div>
          </div>
        </div>
        <div class="uf-sec"><div class="uf-insp" id="ufInsp"></div></div>
      </div>
      <div class="uf-pbody" id="ufBodyIo" hidden>
        <div class="uf-sec"><div class="uf-sech">diagram</div><div class="uf-secb">
          <button class="uf-iobtn" id="ufSaveMmd">
            save .mmd<span class="uf-ld">download the current diagram</span>
          </button>
          <button class="uf-iobtn" id="ufLoadMmd">
            load .mmd…<span class="uf-ld">replace the diagram from a file</span>
          </button>
          <input type="file" id="ufLoadMmdFile" accept=".mmd,.txt" hidden>
        </div></div>
        <div class="uf-sec"><div class="uf-sech">source bodies</div><div class="uf-secb">
          <button class="uf-iobtn" id="ufLoadBodies">
            load bodies.json…
            <span class="uf-ld">function bodies for the source pane — read locally, never uploaded</span>
          </button>
          <input type="file" id="ufLoadBodiesFile" accept=".json,application/json" hidden>
          <div class="uf-ioinfo" id="ufBodiesInfo"></div>
        </div></div>
        <div class="uf-sec"><div class="uf-sech">plan</div><div class="uf-secb">
          <button class="uf-iobtn" id="ufReviewPlan">
            review plan…<span class="uf-ld">open the build-plan review overlay</span>
          </button>
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
          <div class="uf-ioinfo" id="ufSliceBodiesInfo">Body slice</div>
          <textarea class="uf-mmdtext" id="ufSliceBodies" spellcheck="false" readonly></textarea>
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

function injectUnfoldCss(): void {
  if (document.getElementById('unfoldCss')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'unfoldCss';
  styleEl.textContent = UNFOLD_CSS;
  document.head.appendChild(styleEl);
}

function buildOverlayDom(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'uf-overlay';
  overlay.id = 'unfoldOverlay';
  overlay.innerHTML = UNFOLD_OVERLAY_HTML;
  document.body.appendChild(overlay);
  return overlay;
}

function queryUfEl(overlay: HTMLElement, id: string): HTMLElement {
  return overlay.querySelector('#' + id) as HTMLElement;
}

function makeUfEl(tag: string, cls?: string, html?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}

type UfDomRefs = {
  stageEl: HTMLElement; worldEl: HTMLElement; contentEl: HTMLElement; wiresEl: SVGSVGElement;
  stageLayer: HTMLElement; sWiresEl: SVGSVGElement;
};

// builds the real stage/world/content/wires DOM refs plus the stage-layer host that
// unfold-stage.ts owns (created up front here — no placeholder/real two-phase dance
// needed since the whole env is assembled before any sibling factory ever sees it)
function createDomRefs(overlay: HTMLElement): UfDomRefs {
  const stageEl = queryUfEl(overlay, 'ufStage');
  const worldEl = queryUfEl(overlay, 'ufWorld');
  const contentEl = queryUfEl(overlay, 'ufContent');
  const wiresEl = queryUfEl(overlay, 'ufWires') as unknown as SVGSVGElement;
  const stageLayer = makeUfEl('div', 'uf-stagelayer');
  stageEl.appendChild(stageLayer);
  const sWiresEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
  return { stageEl, worldEl, contentEl, wiresEl, stageLayer, sWiresEl };
}

type UfModel = {
  U: Map<string, UNode>; ROOTS: string[]; EDGES: UEdge[]; OUT: Record<string, UEdge[]>; IN: Record<string, UEdge[]>;
  viewXform: { x: number; y: number; k: number }; ALLOW: Set<string>; REP_HOPS: Map<string, number>;
  prevShown: Set<string>; wiresEverDrawn: Set<string>;
};

function createEmptyUfModel(): UfModel {
  const model = {
    ROOTS: [] as string[],
    EDGES: [] as UEdge[],
    OUT: {} as Record<string, UEdge[]>,
    viewXform: { x: 0, y: 0, k: 1 },
    ALLOW: new Set<string>(),
    REP_HOPS: new Map<string, number>(),
    prevShown: new Set<string>(),
    wiresEverDrawn: new Set<string>(),
  } as unknown as UfModel;
  model['U'] = new Map<string, UNode>();
  model['IN'] = {};
  return model;
}

type UfScalars = {
  spec: ViewSpec; connectFrom: string | null; actionsMenuOpen: boolean; firstFit: boolean;
  repaintAction: string; wireEnterAt: number; TRUST_SRC: boolean; trustFileEl: HTMLInputElement | null;
};

function createInitialUfScalars(): UfScalars {
  return {
    spec: emptyViewSpec(),
    connectFrom: null,
    actionsMenuOpen: false,
    firstFit: true,
    repaintAction: 'reveal',
    wireEnterAt: 0,
    TRUST_SRC: false,
    trustFileEl: null,
  };
}

// assembles the shared UEnv in one shot from the DOM refs + empty model + initial
// scalars (q/h are attached last since they close over this call's own `overlay`)
function createUnfoldEnv(ctx: AppContext, deps: UnfoldDeps, overlay: HTMLElement): UEnv {
  const env = {} as UEnv;
  Object.assign(env, { ctx, deps, overlay }, createDomRefs(overlay), createEmptyUfModel(), createInitialUfScalars());
  env['q'] = (id: string): HTMLElement => queryUfEl(overlay, id);
  env['h'] = makeUfEl;
  return env;
}

function wireUnfoldFactories(env: UEnv): void {
  initUnfoldView(env);
  initUnfoldWires(env);
  initUnfoldInspect(env);
  initUnfoldInspect2(env);
  initUnfoldSession(env);
  initUnfoldSession2(env);
  initUnfoldStage(env);
  initUnfoldStage2(env);
}

function wireLegacyCompareButton(env: UEnv): void {
  // the ONLY route out of unfold: the explicit legacy-compare affordance
  // (temporary — dies with the canvas at M5 parity); Esc never lands here
  env.q('ufCompare').onclick = () => env.close();
}

function buildUnfoldApi(env: UEnv, overlay: HTMLElement): UnfoldApi {
  return {
    open: env.open,
    close: env.close,
    toggle: () => (overlay.classList.contains('show') ? env.close() : env.open()),
    refreshFromModel: env.refreshFromModel,
  };
}

// composition root for reading mode: builds the overlay DOM/CSS, constructs the
// shared `env` environment, wires every sibling factory's functions into it, and
// returns the public open/close/toggle/refreshFromModel API
export function initUnfold(ctx: AppContext, deps: UnfoldDeps): UnfoldApi {
  injectUnfoldCss();
  const overlay = buildOverlayDom();
  const env = createUnfoldEnv(ctx, deps, overlay);
  wireUnfoldFactories(env);
  env.trustLayer();
  wireLegacyCompareButton(env);
  return buildUnfoldApi(env, overlay);
}
