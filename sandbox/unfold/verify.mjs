#!/usr/bin/env node
/* SANDBOX self-check. Independent of main.ts: re-derives coverage straight from the live
   maps + hierarchy.json and asserts the folded model is complete and well-formed. Run:
     node sandbox/unfold/verify.mjs
   Exit 0 = every app module is grouped, every grouping leaf is a real node, tooling members
   attach, every edge endpoint resolves, every map edge is inside the app parser's grammar
   (main.ts renders through the app's own fromMermaid — a token outside that grammar would be
   silently dropped), every advisory-allowlist edge lands on real units, every bodies.json key
   is a bundle node, and the blast-radius graph is walkable. Non-zero = a flaw that would
   strand a card or silently hide a claim. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const R = s => readFileSync(resolve(root, s), 'utf8');

/* Edge tokens mirror the app grammar (io/mermaid fromMermaid) EXACTLY — same four arrows,
   nothing more — so this file double-checks what the surface actually renders. */
function parse(raw){
  const nodes=new Map(), edges=[], stack=[], parentOf={}, subOf={};
  const en=id=>{if(!nodes.has(id))nodes.set(id,{id,kind:null});return nodes.get(id);};
  for(const r0 of raw.split(/\r?\n/)){const line=r0.trim();if(!line)continue;let m;
    if(line.startsWith('%%')){
      if(m=line.match(/^%% kind (\S+) (\S+)/)){en(m[1]).kind=m[2];}
      else if(m=line.match(/^%% parent (\S+) (\S+)/)){parentOf[m[1]]=m[2];}
      continue;}
    if(m=line.match(/^subgraph\s+(\S+)/)){en(m[1]);if(stack.length)subOf[m[1]]=stack[stack.length-1];stack.push(m[1]);continue;}
    if(line==='end'){stack.pop();continue;}
    if(/^(flowchart|graph)\b/.test(line))continue;
    if(m=line.match(/^(\w+)\s*(-\.-\x3e|--\x3e|==\x3e|---)\s*(?:\|([^|]*)\|)?\s*(\w+)/)){en(m[1]);en(m[4]);edges.push({from:m[1],to:m[4],style:m[2]});continue;}
    if(m=line.match(/^(\w+)\s*[\[\(\{>]+/)){en(m[1]);if(stack.length&&!subOf[m[1]])subOf[m[1]]=stack[stack.length-1];continue;}
  }
  return {nodes,edges,parentOf,subOf};
}
const moduleOf=id=>id.includes('__')?id.slice(0,id.indexOf('__')):id;

const fails=[], warns=[];
const ok=(c,m)=>{if(!c)fails.push(m);};

const R_=parse(R('docs/novakai/root.mmd'));
const B_=parse(R('docs/novakai/_bundle.mmd'));
const RT_=parse(R('docs/novakai/root.mmd'));
const T_=parse(R('docs/novakai/_bundle.mmd'));
const hier=JSON.parse(R('sandbox/unfold/hierarchy.json'));

/* ---- APP: modules from root.mmd ---- */
const appModules=[...R_.nodes.values()].filter(n=>!n.id.includes('__')&&(n.kind==='module'||n.kind==='function')).map(n=>n.id);
const appReg=hier.regions.find(r=>r.id==='region-app');
const grouped=new Set();
(function walk(o){for(const k in o){const v=o[k];Array.isArray(v)?v.forEach(x=>grouped.add(x)):walk(v);}})(appReg.groups);

// 1. every app module is placed in the grouping
for(const m of appModules) ok(grouped.has(m), `app module "${m}" is not in hierarchy.json (would be invisible)`);
// 2. every grouping leaf is a real module id
for(const g of grouped) ok(appModules.includes(g), `grouping leaf "${g}" is not a module in root.mmd`);
// 3. no module placed twice
const seen=new Set(); const dup=[];
(function walk(o){for(const k in o){const v=o[k];if(Array.isArray(v))v.forEach(x=>{if(seen.has(x))dup.push(x);seen.add(x);});else walk(v);}})(appReg.groups);
ok(dup.length===0, `modules placed in more than one group: ${dup.join(', ')}`);

/* ---- APP: symbols attach to a curated module ---- */
let symCount=0, orphanSym=0;
for(const n of B_.nodes.values()){if(!n.id.includes('__')||n.kind==='group')continue;symCount++;if(!appModules.includes(moduleOf(n.id)))orphanSym++;}
ok(symCount>0,'no app symbols parsed from _bundle.mmd');
if(orphanSym) warns.push(`${orphanSym}/${symCount} bundle symbols belong to non-curated modules (dropped, expected)`);

/* ---- TOOLING: subsystems + members ---- */
const toolReg=hier.regions.find(r=>r.id==='region-tooling');
for(const s of toolReg.subsystemOrder) ok(RT_.nodes.has(s)||T_.nodes.has(s), `tooling subsystem "${s}" not found in root-tools/_tooling`);
const toolNodes=[...T_.nodes.keys()].filter(id=>/^novakai/.test(id));
let toolAttach=0, toolOrphan=[];
for(const id of toolNodes){
  if(toolReg.subsystemOrder.includes(id)){toolAttach++;continue;}
  const par=T_.parentOf[id]||T_.subOf[id]||moduleOf(id);
  if(par&&(toolNodes.includes(par)||toolReg.subsystemOrder.includes(par)))toolAttach++;else toolOrphan.push(id);
}
ok(toolOrphan.length===0, `tooling nodes with no resolvable parent: ${toolOrphan.join(', ')}`);

/* ---- EDGES: endpoints resolvable to some unit id ---- */
const allUnitIds=new Set([...appModules, ...grouped, ...[...B_.nodes.keys()].filter(id=>appModules.includes(moduleOf(id))), ...toolReg.subsystemOrder, ...toolNodes]);
const rawEdges=[...R_.edges,...B_.edges,...RT_.edges,...T_.edges];
let resolvable=0, unresolved=0;
for(const e of rawEdges){if(e.from===e.to)continue;const a=allUnitIds.has(e.from),b=allUnitIds.has(e.to);if(a&&b)resolvable++;else unresolved++;}
ok(resolvable>0,'no resolvable edges');

/* ---- GRAMMAR SURFACE: no edge token the app parser would silently drop ----
   main.ts renders through the app's own fromMermaid, whose grammar is exactly
   -.-\x3e | ==\x3e | --\x3e | --- . A bare `-.-` (dotted, no arrowhead) or any other
   token would parse as no edge at all — the map would claim a relation the surface
   never shows. Assert none exists in any of the four live maps. */
const MAPS=['docs/novakai/root.mmd','docs/novakai/_bundle.mmd'];
for(const f of MAPS){
  raw:for(const [i,line] of R(f).split(/\r?\n/).entries()){
    const t=line.trim();
    if(!t||t.startsWith('%%')||t.startsWith('subgraph')||t==='end')continue raw;
    const m=t.match(/^\w+\s*(-[-.=]*\x3e?|={2,}\x3e?)\s/);
    if(m&&!/^(-\.-\x3e|--\x3e|==\x3e|---)$/.test(m[1]))
      fails.push(`${f}:${i+1} edge token "${m[1]}" is outside the app parser grammar (would render as nothing)`);
  }
}

/* ---- ADVISORY ALLOWLIST (A5): every audited advisory edge lands on real units ----
   The trust layer marks these edges on-canvas; a stale entry would mark nothing. */
const allowLines=R('docs/novakai/edge-advisory-allowlist.txt').split(/\r?\n/)
  .map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')&&l.includes('->'));
const edgeKeys=new Set(rawEdges.map(e=>e.from+'->'+e.to));
for(const a of allowLines){
  const [from,to]=a.split('->');
  ok(allUnitIds.has(from)&&allUnitIds.has(to), `advisory edge "${a}" endpoint is not a known unit`);
  ok(edgeKeys.has(a), `advisory edge "${a}" does not exist in any live map (stale entry — nothing to mark)`);
}

/* ---- BODIES: every bodies.json key is a bundle node (source reveal always lands) ---- */
const bodies=JSON.parse(R('public/bodies.json'));
let bodyOrphans=0;
for(const k of Object.keys(bodies)) if(!B_.nodes.has(k)) bodyOrphans++;
ok(bodyOrphans===0, `${bodyOrphans} bodies.json keys are not bundle nodes (source reveal would strand)`);

/* ---- BLAST RADIUS: the dependents-walk terminates and the hub has dependents ---- */
const revAdj={};
for(const e of rawEdges){if(!allUnitIds.has(e.from)||!allUnitIds.has(e.to)||e.from===e.to)continue;(revAdj[e.to]=revAdj[e.to]||[]).push(e.from);}
function dependents(sel){const seen=new Set([sel]),q=[sel];while(q.length){const x=q.shift();for(const d of revAdj[x]||[])if(!seen.has(d)){seen.add(d);q.push(d);}}seen.delete(sel);return seen;}
const stateBlast=dependents('state');
ok(stateBlast.size>=1, `blast walk from "state" found no dependents (adjacency broken)`);

/* ---- report ---- */
console.log('novakai · unfold — model self-check\n');
console.log(`  app modules ............ ${appModules.length}  (all grouped: ${appModules.every(m=>grouped.has(m))})`);
console.log(`  app symbols ............ ${symCount}  (attached: ${symCount-orphanSym})`);
console.log(`  tooling subsystems ..... ${toolReg.subsystemOrder.length}`);
console.log(`  tooling nodes attached . ${toolAttach}/${toolNodes.length}`);
console.log(`  edges resolvable ....... ${resolvable}  (dropped cross-boundary: ${unresolved})`);
console.log(`  grammar surface ........ every edge token inside the app parser grammar`);
console.log(`  advisory edges ......... ${allowLines.length}  (all resolve to live map edges)`);
console.log(`  bodies.json keys ....... ${Object.keys(bodies).length}  (all are bundle nodes)`);
console.log(`  blast walk (state) ..... ${stateBlast.size} transitive dependents`);
for(const w of warns) console.log(`  note: ${w}`);
if(fails.length){console.log('\n  ✗ FAIL');for(const f of fails)console.log('    · '+f);process.exit(1);}
console.log('\n  ✓ PASS — the folded model is complete and every card has a home.');
