/* =====================================================================
   main.ts — composition root + boot
   ---------------------------------------------------------------------
   Responsibility: the ONLY module that knows about every other module.
   It:
     1. resolves the DOM,
     2. builds the AppContext (model, camera, prefs, history, clipboard,
        runtime),
     3. instantiates each module's init() in dependency order,
     4. wires ctx.hooks to the real implementations (this is what lets
        modules call each other without import cycles),
     5. binds the remaining top-level DOM (toolbar buttons, help overlay,
        window events),
     6. loads prefs + autosave (or seeds) and performs the first render.

   No business logic lives here — only construction + wiring.
   ===================================================================== */

import type { AppContext } from './core/context/context';
import { createHooks } from './core/context/context';
import { createState } from './core/state/state';
import { createHistory, initHistory } from './core/history/history';
import { createRuntime } from './core/runtime/runtime';
import { DEFAULT_PREFS } from './core/config/config';
import { seed } from './core/seed/seed';
import { initPersistence, loadPrefs } from './core/persistence/persistence';
import { savePrefs } from './core/persistence/persistence';

import { initCamera } from './core/camera/camera';
import { initWires } from './render/wires';
import { routeReferences } from './render/avoidRouter';
import { initRender } from './render/render';
import { initMinimap } from './render/minimap';

import { initSelection } from './interaction/selection';
import { initNodes } from './interaction/nodes';
import { initClipboard } from './interaction/clipboard';
import { initPointer } from './interaction/pointer';
import { initInlineEdit } from './interaction/inline-edit';
import { initKeyboard } from './interaction/keyboard';
import { initContextMenu } from './interaction/context-menu';
import { initView } from './interaction/view';

import { initTheming } from './panel/theming';
import { initStyleControls } from './panel/style-controls';
import { initInspector } from './panel/inspector';
import { initNavigator } from './panel/navigator';
import { initSlice } from './panel/slice';
import { initPlanner } from './panel/planner';
import { initTabs } from './panel/tabs';
import { initUnfold } from './panel/unfold';

import { initMermaid } from './io/mermaid';
import { initLayout } from './io/layout';
import { initExport } from './io/export';
import { initFiles } from './io/files';

import type { ShapeKind } from './core/types/types';

/* ---------- 1. resolve DOM ---------- */
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

const ctx: AppContext = {
  dom: {
    stage: $('stage'),
    world: $('world'),
    wires: $('wires') as unknown as SVGSVGElement,
    mmd: $('mmd') as HTMLTextAreaElement,
    main: $('main'),
  },
  state: createState(),
  cam: { x: 0, y: 0, z: 1 },
  prefs: { ...DEFAULT_PREFS },
  history: createHistory(),
  clipboard: { nodes: [], edges: [] },
  runtime: createRuntime(),
  snap: true,
  mmShow: true,
  lastMouseWorld: null,
  view: { container: null },
  bodies: null,
  plan: null,
  hooks: createHooks(),
};

/* ---------- 2. load prefs (before any visual init) ---------- */
loadPrefs(ctx.prefs);
ctx.snap = ctx.prefs.snap;
ctx.mmShow = ctx.prefs.map;

/* ---------- 3. instantiate modules (dependency order) ---------- */
const persistence = initPersistence(ctx);
const camera = initCamera(ctx);
const minimap = initMinimap(ctx, camera);
const wiresMod = initWires(ctx);
const render = initRender(ctx, wiresMod.drawWires);
const history = initHistory(ctx);
const tabs = initTabs(ctx);
const selection = initSelection(ctx);
const nodes = initNodes(ctx, selection, camera);
const clipboard = initClipboard(ctx);
const inspector = initInspector(ctx, nodes, selection);
const mermaid = initMermaid(ctx, selection);
const theming = initTheming(ctx);
const layout = initLayout(ctx, camera);
const exporter = initExport(ctx);
const files = initFiles(ctx, mermaid, camera);
const inlineEdit = initInlineEdit(ctx, camera, nodes);
const pointer = initPointer(ctx, camera, selection, nodes);
const view = initView(ctx, camera);
const navigatorMod = initNavigator(ctx, { selection, view, camera });
const sliceMod = initSlice(ctx, { mermaid });
const planner = initPlanner(ctx, { mermaid });
const unfold = initUnfold(ctx, { selection, camera, files, mermaid });
const contextMenu = initContextMenu(ctx, { camera, selection, nodes, clipboard, inlineEdit, view });

initKeyboard(ctx, {
  camera, selection, nodes, clipboard, pointer, inlineEdit, history, view,
  togglePanel: tabs.togglePanel,
  hideCtx: contextMenu.hideCtx,
});

/* ---------- 4. wire hooks ---------- */
ctx.hooks.render = render.render;
ctx.hooks.redrawWires = wiresMod.drawWires;
ctx.hooks.redrawWiresFor = wiresMod.updateWiresFor;
ctx.hooks.sync = mermaid.sync;
ctx.hooks.renderInspector = inspector.renderInspector;
ctx.hooks.drawMinimap = minimap.drawMinimap;
ctx.hooks.applyCam = camera.applyCam;
ctx.hooks.persist = persistence.persist;
ctx.hooks.pushHistory = history.pushHistory;
ctx.hooks.updateUndoButtons = history.updateUndoButtons;
ctx.hooks.toast = tabs.toast;
ctx.hooks.showTab = tabs.showTab;
ctx.hooks.reroute = () => { void routeReferences(ctx).then(() => render.render()); };
ctx.hooks.rerouteEdges = (ids) => { void routeReferences(ctx, { onlyEdgeIds: ids }).then(() => render.render()); };
ctx.hooks.enterContainer = view.enter;
ctx.hooks.renderNavigator = navigatorMod.render;
ctx.hooks.renderSlice = sliceMod.render;

/* ---------- 5. bind remaining top-level DOM ---------- */
// shape toolbar
document.querySelectorAll('#shapeTools .tool').forEach((b) => {
  (b as HTMLElement).onclick = () => { pointer.setLinkMode(false); nodes.addNode((b as HTMLElement).dataset.shape as ShapeKind); };
});

$('linkBtn').onclick = () => pointer.setLinkMode(!pointer.isLinkMode());
($('undoBtn') as HTMLButtonElement).onclick = history.undo;
($('redoBtn') as HTMLButtonElement).onclick = history.redo;
$('layoutBtn').onclick = layout.autoLayout;
$('snapBtn').onclick = () => {
  ctx.snap = !ctx.snap; ctx.prefs.snap = ctx.snap; savePrefs(ctx.prefs);
  const os = document.getElementById('optSnap') as HTMLInputElement | null;
  if (os) os.checked = ctx.snap;
  $('snapBtn').classList.toggle('active', ctx.snap);
  tabs.toast(ctx.snap ? 'Snap on' : 'Snap off');
};
$('exportPngBtn').onclick = exporter.exportPNG;
$('exportSvgBtn').onclick = exporter.exportSVG;

$('applyMmd').onclick = mermaid.applyText;
$('copyMmd').onclick = () => { navigator.clipboard.writeText(ctx.dom.mmd.value); tabs.toast('Copied mermaid'); };
$('addQuick').onclick = () => nodes.addNode('rect');
$('clearAll').onclick = () => {
  if (!Object.keys(ctx.state.nodes).length) return;
  if (confirm('Clear the whole canvas?')) {
    ctx.state.nodes = {}; ctx.state.edges = []; ctx.state.nid = 1; ctx.state.eid = 1;
    ctx.state.hier = { groups: {}, memberOf: {} };
    selection.clearSel(); render.render(); mermaid.sync(); history.pushHistory();
  }
};

$('saveBtn').onclick = files.saveMmd;
// D2 — one review surface: the Diff button opens the planner in raw-proposal
// mode (paste an after-map → diffed into a reviewable plan); the Plan button
// opens it for an authored plan.json. Both flow through the same review path.
$('diffBtn').onclick = planner.openProposal;
$('plannerBtn').onclick = planner.open;
$('readBtn').onclick = unfold.toggle;

$('zIn').onclick = () => camera.zoomCenter(ctx.cam.z * 1.2);
$('zOut').onclick = () => camera.zoomCenter(ctx.cam.z / 1.2);
$('zFit').onclick = camera.zoomToFit;
$('zLevel').onclick = camera.zoomToFit;
$('zHome').onclick = () => view.goTo(null);

$('helpBtn').onclick = () => $('helpOverlay').classList.toggle('show');
$('helpClose').onclick = () => $('helpOverlay').classList.remove('show');
$('helpOverlay').onclick = (e) => { if (e.target === $('helpOverlay')) $('helpOverlay').classList.remove('show'); };
$('snapBtn').classList.add('active');

// help content
const HELP: [string, string][] = [
  ['Drop shape', 'click toolbar / 1–9'],
  ['New box', 'double-click canvas'],
  ['Rename', 'double-click / Enter'],
  ['Link nodes', 'drag from orange port'],
  ['Link mode', 'L'],
  ['Multi-select', 'drag marquee / Shift-click'],
  ['Select all', '⌘/Ctrl A'],
  ['Move', 'drag / arrow keys'],
  ['Move by grid', 'Shift + arrows'],
  ['Duplicate', '⌘/Ctrl D'],
  ['Copy / paste', '⌘/Ctrl C / V'],
  ['Delete', 'Delete / Backspace'],
  ['Undo / redo', '⌘/Ctrl Z / ⇧Z'],
  ['Pan', 'scroll / Space-drag / middle-drag'],
  ['Zoom', 'pinch / ⌘-scroll / +  −'],
  ['Zoom to fit', 'F  (or click %)'],
  ['Auto-layout', 'Tidy button'],
  ['Toggle panel', 'Tab'],
];
$('helpGrid').innerHTML = HELP.map(([a, b]) => `<div class="k"><span>${a}</span><span><kbd>${b}</kbd></span></div>`).join('');

window.addEventListener('beforeunload', persistence.persist);

/* ---------- 6. boot ---------- */
initStyleControls(ctx, theming);
theming.applyTheme(ctx.prefs.theme, false); // set CSS vars (render happens below)
theming.applyFont(ctx.prefs.font);
if (!persistence.loadPersisted()) seed(ctx.state);
theming.applyCanvasPrefs();
camera.applyCam();
render.render();
view.renderBreadcrumb();
mermaid.sync();
tabs.showTab('insp');
history.pushHistory(); // baseline
history.updateUndoButtons();
unfold.open(); // boot has no surface decision — unfold IS the app (M4 correction); the legacy canvas underneath stays initialized for the compare affordance

/* ---------- 7. load source bodies (local-dev convenience only) ----------
   Optional same-origin bodies.json. It is NOT shipped on the public deploy
   (gitignored), so this 404s there and the catch is a silent no-op — users
   load their own file via the Bodies button (io/files.ts), read in-browser
   and never uploaded. Kept so a local checkout that still has its own
   public/bodies.json auto-loads it. */
fetch('bodies.json')
  .then((r) => r.ok ? r.json() : null)
  .then((data) => {
    if (!data || typeof data !== 'object') return;
    ctx.bodies = new Map(Object.entries(data));
    ctx.hooks.renderInspector(); // refresh source pane if it is already open
  })
  .catch(() => { /* no bodies.json — source tab shows the hint */ });
