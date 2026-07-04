#!/usr/bin/env node
/* =====================================================================
   flowmap-lint.mjs — semantic quality gate for a Flowmap .mmd.
   Goes beyond validate.mjs (grammar legality). Checks the structural
   properties that separate a real architecture map from a flat file-mirror.
   Every check below is DERIVED FROM MEASURED DATA on a human-validated GOOD
   bundle (NovaKai) vs a human-rejected BAD bundle (flowmap file-mirror), and
   GROUNDED in the app's own containment (src/core/state.ts containerOf) and
   layout (src/io/layout.ts isSpineEdge) source.

   Exit 1 on any FAIL (wire "done = lint passes"); warnings never fail.
   Usage: flowmap-lint <file.mmd> [--report]
   ===================================================================== */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';

const FLAT_FAIL_MIN_NODES = 8; // §8 worked example is 5 nodes & legitimately flat; repo flowmaps are >> this

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
function childIdsOf(nodes, c) { return Object.keys(nodes).filter((id) => containerOf(nodes, id) === c); }
// spineWithinLevel — verbatim behavior from src/io/layout.ts:100 (isSpineEdge = style !== 'dotted')
function spineWithinLevel(model, ids) {
  const S = new Set(ids); const sp = new Set();
  for (const e of model.edges) { if (e.style === 'dotted') continue; if (S.has(e.from) && S.has(e.to)) { sp.add(e.from); sp.add(e.to); } }
  for (const r of model.roots) if (S.has(r)) sp.add(r);
  for (const id of [...sp]) if (model.nodes[id]?.group) sp.delete(id);
  return sp;
}
function wc(s) { return (s || '').trim() ? (s).trim().split(/\s+/).length : 0; }

export function lint(text) {
  const model = parseMmd(text);
  const { nodes } = model;
  const real = Object.keys(nodes).filter((id) => !nodes[id].group);
  const groups = Object.keys(nodes).filter((id) => nodes[id].group);
  const drill = real.filter((id) => childIdsOf(nodes, id).length > 0);
  const fails = [], warns = [];

  // F1 LOOSE-BAG — decomposed unit (>=2 real children) with no section. [BAD=5, GOOD=0]
  for (const u of drill) {
    const kids = childIdsOf(nodes, u);
    const realKids = kids.filter((k) => !nodes[k].group);
    const sections = kids.filter((k) => nodes[k].group);
    if (realKids.length >= 2 && sections.length === 0) {
      fails.push(`LOOSE-BAG: unit '${u}' drills into ${realKids.length} nodes with 0 sections. ` +
        `Group them into purpose subgraphs parented into '${u}' (spec §6/§7.10). ` +
        `Children: ${realKids.slice(0, 8).join(', ')}${realKids.length > 8 ? '…' : ''}`);
    } else if (realKids.length === 1 && sections.length === 0) {
      warns.push(`SINGLE-CHILD: unit '${u}' drills into 1 node, unsectioned. Section it or use a note caption (spec §6).`);
    }
  }


  // F3 FLAT-MAP — many nodes, zero decomposition. [catches flat file-mirror; small toys exempt]
  if (real.length >= FLAT_FAIL_MIN_NODES && drill.length === 0)
    fails.push(`FLAT: ${real.length} nodes, 0 drilled units. A repo flowmap at architecture altitude ` +
      `cannot carry a review — decompose reviewable units to function altitude (spec §6/§7.9).`);

  // W: bare-leaf detail (supporting evidence for F1) — leaf parented onto a non-group unit
  const bareLeaf = real.filter((id) => { const p = nodes[id].parent; return p && nodes[p] && !nodes[p].group; });
  if (bareLeaf.length) warns.push(`BARE-LEAF: ${bareLeaf.length} node(s) parented directly onto a unit instead of into a section ` +
    `(the section, not the leaf, carries %% parent): ${bareLeaf.slice(0, 8).join(', ')}${bareLeaf.length > 8 ? '…' : ''}`);

  // W: no root
  if ((model.roots || []).length === 0)
    warns.push(`NO-ROOT: no %% root declared — the single biggest layout lever (spec §1).`);

  // W: stub unit — top-level single node, no children, no interface, thin/absent desc (tiny diagrams exempt)
  if (real.length >= FLAT_FAIL_MIN_NODES) for (const id of real) {
    if (containerOf(nodes, id) !== null) continue;
    if (childIdsOf(nodes, id).length > 0) continue;
    const f = model.fm[id];
    const hasIface = f && (f.interfaces || []).some((i) => i.name || i.accepts.length || i.returns.length);
    const descWords = wc(f && f.description);
    if (!hasIface && descWords < 4)
      warns.push(`STUB: top-level unit '${id}' has no children, no interface, and ${descWords ? 'a ' + descWords + '-word' : 'no'} desc. ` +
        `Decompose it or give it frontmatter (spec §6: a single node is at architecture altitude).`);
  }

  return { model, real, groups, drill, fails, warns };
}

function report(r) {
  const { model, real, groups, drill } = r;
  const nodes = model.nodes;
  let depth = 0;
  for (const id of real) { let d = 0, c = containerOf(nodes, id); const seen = new Set(); while (c && !seen.has(c)) { seen.add(c); d++; c = containerOf(nodes, c); } depth = Math.max(depth, d); }
  const eStyle = { solid: 0, thick: 0, dotted: 0 }; for (const e of model.edges) eStyle[e.style]++;
  console.log(`\n— STRUCTURE REPORT —`);
  console.log(`real nodes        ${real.length}`);
  console.log(`sections          ${groups.length}`);
  console.log(`top-level units   ${real.filter((id) => containerOf(nodes, id) === null).length}`);
  console.log(`drilled units     ${drill.length}   max drill depth ${depth}`);
  console.log(`edges             solid ${eStyle.solid} | thick ${eStyle.thick} | dotted ${eStyle.dotted}`);
  console.log(`\nper drilled unit:  unit | realKids | sections | within-level spine`);
  for (const u of drill) {
    const kids = childIdsOf(nodes, u);
    console.log(`  ${u.padEnd(20)} ${String(kids.filter((k) => !nodes[k].group).length).padEnd(9)}${String(kids.filter((k) => nodes[k].group).length).padEnd(11)}${spineWithinLevel(model, kids).size}`);
  }
}

// CLI — only when run directly, not when imported by tests
// resolve symlinks so this also fires when invoked via a node_modules/.bin shim
const __invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : '';
if (import.meta.url === __invoked) {
  const args = process.argv.slice(2);
  const wantReport = args.includes('--report');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) { console.error('usage: flowmap-lint <file.mmd> [--report]'); process.exit(2); }
  const r = lint(readFileSync(path, 'utf8'));
  console.log(`flowmap-lint: ${path}`);
  for (const f of r.fails) console.log('  FAIL  ' + f);
  for (const w of r.warns) console.log('  warn  ' + w);
  if (wantReport) report(r);
  console.log(r.fails.length ? `\nRESULT: FAIL (${r.fails.length} error(s), ${r.warns.length} warning(s))` : `\nRESULT: PASS (${r.warns.length} warning(s))`);
  process.exit(r.fails.length ? 1 : 0);

}
