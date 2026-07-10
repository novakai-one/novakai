#!/usr/bin/env node
/* =====================================================================
   novakai-lint.mjs — semantic quality gate for a Novakai .mmd.
   Goes beyond validate.mjs (grammar legality). Checks the structural
   properties that separate a real architecture map from a flat file-mirror.
   Every check below is DERIVED FROM MEASURED DATA on a human-validated GOOD
   bundle (NovaKai) vs a human-rejected BAD bundle (novakai file-mirror), and
   GROUNDED in the app's own containment (src/core/state.ts containerOf) and
   layout (src/io/layout.ts isSpineEdge) source.

   Exit 1 on any FAIL (wire "done = lint passes"); warnings never fail.
   Usage: novakai-lint <file.mmd> [--report]
   ===================================================================== */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';

const FLAT_FAIL_MIN_NODES = 8; // §8 worked example is 5 nodes & legitimately flat; repo novakais are >> this

// containerOf — verbatim behavior from src/core/state.ts:143
function containerOf(nodes, id) {
  let cur = nodes[id]?.parent ?? null;
  const seen = new Set();
  while (cur && nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    if (nodes[cur].shape !== 'group') return cur;
    cur = nodes[cur].parent ?? null;
  }
  return null;
}
function childIdsOf(nodes, containerId) {
  return Object.keys(nodes).filter((id) => containerOf(nodes, id) === containerId);
}
// spineWithinLevel — verbatim behavior from src/io/layout.ts:100 (isSpineEdge = style !== 'dotted')
function spineWithinLevel(model, ids) {
  const levelIds = new Set(ids);
  const spine = new Set();
  for (const edge of model.edges) {
    if (edge.style === 'dotted') continue;
    if (levelIds.has(edge.from) && levelIds.has(edge.to)) {
      spine.add(edge.from);
      spine.add(edge.to);
    }
  }
  for (const rootId of model.roots) if (levelIds.has(rootId)) spine.add(rootId);
  for (const id of [...spine]) if (model.nodes[id]?.group) spine.delete(id);
  return spine;
}
function wordCount(text) {
  return (text || '').trim() ? text.trim().split(/\s+/).length : 0;
}

// F1 LOOSE-BAG — decomposed unit (>=2 real children) with no section. [BAD=5, GOOD=0]
function checkLooseBag(nodes, drill) {
  const fails = [];
  const warns = [];
  for (const unit of drill) {
    const kids = childIdsOf(nodes, unit);
    const realKids = kids.filter((kid) => !nodes[kid].group);
    const sections = kids.filter((kid) => nodes[kid].group);
    if (realKids.length >= 2 && sections.length === 0) {
      fails.push(`LOOSE-BAG: unit '${unit}' drills into ${realKids.length} nodes with 0 sections. ` +
        `Group them into purpose subgraphs parented into '${unit}' (spec §6/§7.10). ` +
        `Children: ${realKids.slice(0, 8).join(', ')}${realKids.length > 8 ? '…' : ''}`);
    } else if (realKids.length === 1 && sections.length === 0) {
      warns.push(`SINGLE-CHILD: unit '${unit}' drills into 1 node, unsectioned. ` +
        `Section it or use a note caption (spec §6).`);
    }
  }
  return { fails, warns };
}

// F3 FLAT-MAP — many nodes, zero decomposition. [catches flat file-mirror; small toys exempt]
function checkFlatMap(real, drill) {
  if (real.length < FLAT_FAIL_MIN_NODES || drill.length !== 0) return [];
  return [`FLAT: ${real.length} nodes, 0 drilled units. A repo novakai at architecture altitude ` +
    `cannot carry a review — decompose reviewable units to function altitude (spec §6/§7.9).`];
}

// W: bare-leaf detail (supporting evidence for F1) — leaf parented onto a non-group unit
function checkBareLeaf(nodes, real) {
  const bareLeaf = real.filter((id) => {
    const parent = nodes[id].parent;
    return parent && nodes[parent] && !nodes[parent].group;
  });
  if (!bareLeaf.length) return [];
  const shown = bareLeaf.slice(0, 8).join(', ') + (bareLeaf.length > 8 ? '…' : '');
  return [`BARE-LEAF: ${bareLeaf.length} node(s) parented directly onto a unit instead of into a section ` +
    `(the section, not the leaf, carries %% parent): ${shown}`];
}

// W: no root
function checkNoRoot(model) {
  if ((model.roots || []).length !== 0) return [];
  return [`NO-ROOT: no %% root declared — the single biggest layout lever (spec §1).`];
}

function hasInterface(frontmatter) {
  if (!frontmatter) return false;
  return (frontmatter.interfaces || []).some((iface) => iface.name || iface.accepts.length || iface.returns.length);
}

// W: stub unit — top-level single node, no children, no interface, thin/absent desc (tiny diagrams exempt)
function checkStubUnits(model, nodes, real) {
  const warns = [];
  if (real.length < FLAT_FAIL_MIN_NODES) return warns;
  for (const id of real) {
    if (containerOf(nodes, id) !== null) continue;
    if (childIdsOf(nodes, id).length > 0) continue;
    const frontmatter = model.fm[id];
    const hasIface = hasInterface(frontmatter);
    const descWords = wordCount(frontmatter && frontmatter.description);
    if (hasIface || descWords >= 4) continue;
    const descLabel = descWords ? `a ${descWords}-word` : 'no';
    warns.push(`STUB: top-level unit '${id}' has no children, no interface, and ${descLabel} desc. ` +
      `Decompose it or give it frontmatter (spec §6: a single node is at architecture altitude).`);
  }
  return warns;
}

export function lint(text) {
  const model = parseMmd(text);
  const { nodes } = model;
  const real = Object.keys(nodes).filter((id) => !nodes[id].group);
  const groups = Object.keys(nodes).filter((id) => nodes[id].group);
  const drill = real.filter((id) => childIdsOf(nodes, id).length > 0);

  const looseBag = checkLooseBag(nodes, drill);
  const fails = [...looseBag.fails, ...checkFlatMap(real, drill)];
  const warns = [
    ...looseBag.warns,
    ...checkBareLeaf(nodes, real),
    ...checkNoRoot(model),
    ...checkStubUnits(model, nodes, real),
  ];

  return { model, real, groups, drill, fails, warns };
}

function computeMaxDrillDepth(nodes, real) {
  let depth = 0;
  for (const id of real) {
    let level = 0;
    let container = containerOf(nodes, id);
    const seen = new Set();
    while (container && !seen.has(container)) {
      seen.add(container);
      level++;
      container = containerOf(nodes, container);
    }
    depth = Math.max(depth, level);
  }
  return depth;
}

function countEdgeStyles(model) {
  const eStyle = { solid: 0, thick: 0, dotted: 0 };
  for (const edge of model.edges) eStyle[edge.style]++;
  return eStyle;
}

function reportDrilledUnit(model, nodes, unit) {
  const kids = childIdsOf(nodes, unit);
  const realKidCount = kids.filter((kid) => !nodes[kid].group).length;
  const sectionCount = kids.filter((kid) => nodes[kid].group).length;
  const spineCount = spineWithinLevel(model, kids).size;
  console.log(`  ${unit.padEnd(20)} ${String(realKidCount).padEnd(9)}${String(sectionCount).padEnd(11)}${spineCount}`);
}

function report(result) {
  const { model, real, groups, drill } = result;
  const { nodes } = model;
  const depth = computeMaxDrillDepth(nodes, real);
  const eStyle = countEdgeStyles(model);
  console.log(`\n— STRUCTURE REPORT —`);
  console.log(`real nodes        ${real.length}`);
  console.log(`sections          ${groups.length}`);
  console.log(`top-level units   ${real.filter((id) => containerOf(nodes, id) === null).length}`);
  console.log(`drilled units     ${drill.length}   max drill depth ${depth}`);
  console.log(`edges             solid ${eStyle.solid} | thick ${eStyle.thick} | dotted ${eStyle.dotted}`);
  console.log(`\nper drilled unit:  unit | realKids | sections | within-level spine`);
  for (const unit of drill) reportDrilledUnit(model, nodes, unit);
}

// CLI — only when run directly, not when imported by tests
// resolve symlinks so this also fires when invoked via a node_modules/.bin shim
const __invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (import.meta.url === __invoked) {
  const args = process.argv.slice(2);
  const wantReport = args.includes('--report');
  const path = args.find((arg) => !arg.startsWith('--'));
  if (!path) {
    console.error('usage: novakai-lint <file.mmd> [--report]');
    process.exit(2);
  }
  const result = lint(readFileSync(path, 'utf8'));
  console.log(`novakai-lint: ${path}`);
  for (const fail of result.fails) console.log('  FAIL  ' + fail);
  for (const warn of result.warns) console.log('  warn  ' + warn);
  if (wantReport) report(result);
  console.log(result.fails.length ?
    `\nRESULT: FAIL (${result.fails.length} error(s), ${result.warns.length} warning(s))` :
    `\nRESULT: PASS (${result.warns.length} warning(s))`);
  process.exit(result.fails.length ? 1 : 0);

}
