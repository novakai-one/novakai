#!/usr/bin/env node
/* bodies-from-map.mjs — emit public/bodies.json for the hand-authored flowmap-of-flowmap.
   Keyed by the SAME node ids used in docs/flowmap/root.mmd so the in-app source pane resolves.
   A map entry is either "relpath" (whole-file body, for a module/unit node) or
   "relpath#symbol" (the named declaration's text, for a decomposed function node).
   kind is read from the bundle's `%% kind` lines so labels match the map exactly. */
import { Project, Node } from 'ts-morph';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve('.');
const BUNDLE = 'docs/flowmap/_bundle.mmd';
const OUT = 'public/bodies.json';

// node id -> source location
const MAP = {
  // --- units (whole file) ---
  main:'src/main.ts', types:'src/core/types.ts', state:'src/core/state.ts', context:'src/core/context.ts',
  config:'src/core/config.ts', frontmatter:'src/core/frontmatter.ts', validate:'src/core/validate.ts',
  camera:'src/core/camera.ts', history:'src/core/history.ts', persistence:'src/core/persistence.ts',
  runtime:'src/core/runtime.ts', seed:'src/core/seed.ts',
  pointer:'src/interaction/pointer.ts', nodes:'src/interaction/nodes.ts', selection:'src/interaction/selection.ts',
  clipboard:'src/interaction/clipboard.ts', keyboard:'src/interaction/keyboard.ts', inlineEdit:'src/interaction/inline-edit.ts',
  contextMenu:'src/interaction/context-menu.ts', view:'src/interaction/view.ts',
  mermaid:'src/io/mermaid.ts', layout:'src/io/layout.ts', export:'src/io/export.ts', files:'src/io/files.ts',
  inspector:'src/panel/inspector.ts', inspectorFm:'src/panel/inspector-frontmatter.ts', tabs:'src/panel/tabs.ts',
  styleControls:'src/panel/style-controls.ts', theming:'src/panel/theming.ts',
  render:'src/render/render.ts', wires:'src/render/wires.ts', avoidRouter:'src/render/avoidRouter.ts',
  avoidWorker:'src/render/avoidWorker.ts', minimap:'src/render/minimap.ts',
  // --- layout functions ---
  initLayout:'src/io/layout.ts#initLayout', footprint:'src/io/layout.ts#footprint', captureGroups:'src/io/layout.ts#captureGroups',
  isSpineEdge:'src/io/layout.ts#isSpineEdge', spineNodeSet:'src/io/layout.ts#spineNodeSet', resolveRoots:'src/io/layout.ts#resolveRoots',
  anchorOf:'src/io/layout.ts#anchorOf', findBackEdges:'src/io/layout.ts#findBackEdges', forwardGraph:'src/io/layout.ts#forwardGraph',
  assignLayers:'src/io/layout.ts#assignLayers', orderByBarycenter:'src/io/layout.ts#orderByBarycenter',
  placeSatellites:'src/io/layout.ts#placeSatellites', wrapGroups:'src/io/layout.ts#wrapGroups',
  // --- mermaid functions ---
  fromMermaid:'src/io/mermaid.ts#fromMermaid', toMermaid:'src/io/mermaid.ts#toMermaid', sync:'src/io/mermaid.ts#sync',
  applyText:'src/io/mermaid.ts#applyText', ensureNode:'src/io/mermaid.ts#ensure', parseEdge:'src/io/mermaid.ts#fromMermaid',
  // --- state functions ---
  createState:'src/core/state.ts#createState', portPos:'src/core/state.ts#portPos', nodeCenter:'src/core/state.ts#nodeCenter',
  bestSides:'src/core/state.ts#bestSides', nodeFootprint:'src/core/state.ts#nodeFootprint', snapV:'src/core/state.ts#snapV',
  containerOf:'src/core/state.ts#containerOf', childIdsOf:'src/core/state.ts#childIdsOf', containerPath:'src/core/state.ts#containerPath',
  nodeAtPoint:'src/core/state.ts#nodeAtPoint', levelBounds:'src/core/state.ts#levelBounds',
  // --- pointer functions ---
  initPointer:'src/interaction/pointer.ts#initPointer', startDrag:'src/interaction/pointer.ts#startDrag',
  startResize:'src/interaction/pointer.ts#startResize', startMarquee:'src/interaction/pointer.ts#startMarquee',
  startPan:'src/interaction/pointer.ts#startPan', startLink:'src/interaction/pointer.ts#startLink',
  startLabelDrag:'src/interaction/pointer.ts#startLabelDrag', startBendDrag:'src/interaction/pointer.ts#startBendDrag',
  addGuide:'src/interaction/pointer.ts#addGuide', showAlignGuides:'src/interaction/pointer.ts#showAlignGuides',
  refreshSelClasses:'src/interaction/pointer.ts#refreshSelClasses',
  // --- render functions ---
  renderPass:'src/render/render.ts#initRender', shapeMarkup:'src/render/render.ts#shapeMarkup',
  buildFmCard:'src/render/render.ts#buildFmCard', fmTokenHtml:'src/render/render.ts#fmTokenHtml',
  nameTokenHtml:'src/render/render.ts#nameTokenHtml',
  // --- wires functions ---
  orthoPath:'src/render/wires.ts#orthoPath', polyPath:'src/render/wires.ts#polyPath', pathPoints:'src/render/wires.ts#pathPoints',
  midOf:'src/render/wires.ts#midOf', labelAnchor:'src/render/wires.ts#labelAnchor', drawWires:'src/render/wires.ts#drawWires',
  drawEdge:'src/render/wires.ts#drawEdge', boundaryStub:'src/render/wires.ts#boundaryStub', edgePath:'src/render/wires.ts#edgePath',
  // --- nodes functions ---
  initNodes:'src/interaction/nodes.ts#initNodes', addNode:'src/interaction/nodes.ts#addNode', makeEdge:'src/interaction/nodes.ts#makeEdge',
  deleteSelection:'src/interaction/nodes.ts#deleteSelection', alignNodes:'src/interaction/nodes.ts#alignNodes',
  wrapInGroup:'src/interaction/nodes.ts#wrapInGroup', bringToFront:'src/interaction/nodes.ts#bringToFront',
  // --- avoidRouter functions ---
  obstacleSignature:'src/render/avoidRouter.ts#obstacleSignature', footprintRect:'src/render/avoidRouter.ts#footprintRect',
  sanitizeRect:'src/render/avoidRouter.ts#sanitizeRect', routableEdges:'src/render/avoidRouter.ts#routableEdges',
  ensureRoutes:'src/render/avoidRouter.ts#ensureRoutes', ensureRouter:'src/render/avoidRouter.ts#ensureRouter',
  getWorker:'src/render/avoidRouter.ts#getWorker', handleReply:'src/render/avoidRouter.ts#handleReply',
  // --- inspector functions ---
  renderInspector:'src/panel/inspector.ts#renderInspector', updateStatus:'src/panel/inspector.ts#updateStatus',
  renderSingleInspector:'src/panel/inspector.ts#renderSingleInspector', renderMultiInspector:'src/panel/inspector.ts#renderMultiInspector',
  renderEdgeInspector:'src/panel/inspector.ts#renderEdgeInspector', updateSource:'src/panel/inspector.ts#updateSource',
  // --- frontmatter functions ---
  emptyInterface:'src/core/frontmatter.ts#emptyInterface', emptyFrontmatter:'src/core/frontmatter.ts#emptyFrontmatter',
  normalizeFrontmatter:'src/core/frontmatter.ts#normalizeFrontmatter', isInterfaceEmpty:'src/core/frontmatter.ts#isInterfaceEmpty',
  isFrontmatterEmpty:'src/core/frontmatter.ts#isFrontmatterEmpty', pruneFrontmatter:'src/core/frontmatter.ts#pruneFrontmatter',
  clean:'src/core/frontmatter.ts#clean', frontmatterToMermaid:'src/core/frontmatter.ts#frontmatterToMermaid',
  matchFrontmatterLine:'src/core/frontmatter.ts#matchFrontmatterLine',
  // --- validate functions ---
  edgeIdentities:'src/core/validate.ts#edgeIdentities', inParentCycle:'src/core/validate.ts#inParentCycle',
  validateModel:'src/core/validate.ts#validateModel', isEmptyFm:'src/core/validate.ts#isEmptyFm',
  setEq:'src/core/validate.ts#setEq', fmEqual:'src/core/validate.ts#fmEqual',
  // --- export functions ---
  nodeSVG:'src/io/export.ts#nodeSVG', buildExportSVG:'src/io/export.ts#buildExportSVG',
  exportSVG:'src/io/export.ts#exportSVG', exportPNG:'src/io/export.ts#exportPNG',
  // --- inspectorFm functions ---
  ensureFm:'src/panel/inspector-frontmatter.ts#ensureFm', cleanupIfEmpty:'src/panel/inspector-frontmatter.ts#cleanupIfEmpty',
  stateRowsHtml:'src/panel/inspector-frontmatter.ts#stateRowsHtml', ifaceListRowsHtml:'src/panel/inspector-frontmatter.ts#ifaceListRowsHtml',
  ifaceBlockHtml:'src/panel/inspector-frontmatter.ts#ifaceBlockHtml', fmRender:'src/panel/inspector-frontmatter.ts#render',
  wire:'src/panel/inspector-frontmatter.ts#wire',
};

// kind per id from the bundle
const kindById = {};
for (const line of readFileSync(BUNDLE,'utf8').split('\n')) {
  const m = line.match(/^%%\s*kind\s+([A-Za-z0-9_]+)\s+(\S+)/);
  if (m) kindById[m[1]] = m[2];
}

const project = new Project({ tsConfigFilePath: 'tsconfig.json', skipAddingFilesFromTsConfig: false });

function findSymbol(sf, name) {
  let hit = null;
  sf.forEachDescendant((d) => {
    if (hit) return;
    if ((Node.isFunctionDeclaration(d) || Node.isClassDeclaration(d) || Node.isMethodDeclaration(d)) && d.getName?.() === name) hit = d;
    else if (Node.isVariableDeclaration(d) && d.getName() === name) hit = d.getVariableStatement() ?? d;
  });
  return hit;
}

const bodies = {};
const missing = [];
for (const [id, spec] of Object.entries(MAP)) {
  const [rel, sym] = spec.split('#');
  const sf = project.getSourceFile(resolve(ROOT, rel));
  if (!sf) { missing.push(`${id} (file ${rel})`); continue; }
  const kind = kindById[id] || (sym ? 'function' : 'module');
  if (!sym) { bodies[id] = { kind, body: sf.getFullText().trim() }; continue; }
  const decl = findSymbol(sf, sym);
  if (!decl) { missing.push(`${id} (symbol ${sym} in ${rel})`); continue; }
  bodies[id] = { kind, body: decl.getText().trim() };
}

writeFileSync(OUT, JSON.stringify(bodies, null, 2));
console.log(`wrote ${Object.keys(bodies).length}/${Object.keys(MAP).length} bodies -> ${OUT}`);
if (missing.length) { console.log('UNRESOLVED:'); for (const m of missing) console.log('  - '+m); }
