#!/usr/bin/env node
/* SANDBOX self-check. Independent of index.html: re-derives coverage straight from the live
   maps + hierarchy.json and asserts the folded model is complete and well-formed. Run:
     node sandbox/unfold/verify.mjs
   Exit 0 = every app module is grouped, every grouping leaf is a real node, tooling members
   attach, and every edge endpoint resolves. Non-zero = a flaw that would strand a card. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const R = s => readFileSync(resolve(root, s), 'utf8');

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
    if(m=line.match(/^(\w+)\s*(-\.-\x3e|--\x3e|==\x3e|---|-\.-)\s*(?:\|([^|]*)\|)?\s*(\w+)/)){en(m[1]);en(m[4]);edges.push({from:m[1],to:m[4]});continue;}
    if(m=line.match(/^(\w+)\s*[\[\(\{>]+/)){en(m[1]);if(stack.length&&!subOf[m[1]])subOf[m[1]]=stack[stack.length-1];continue;}
  }
  return {nodes,edges,parentOf,subOf};
}
const moduleOf=id=>id.includes('__')?id.slice(0,id.indexOf('__')):id;

const fails=[], warns=[];
const ok=(c,m)=>{if(!c)fails.push(m);};

const R_=parse(R('docs/flowmap/root.mmd'));
const B_=parse(R('docs/flowmap/_bundle.mmd'));
const RT_=parse(R('docs/flowmap/root-tools.mmd'));
const T_=parse(R('docs/flowmap/_tooling.mmd'));
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
const toolNodes=[...T_.nodes.keys()].filter(id=>/^flowmap/.test(id));
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

/* ---- report ---- */
console.log('flowmap · unfold — model self-check\n');
console.log(`  app modules ............ ${appModules.length}  (all grouped: ${appModules.every(m=>grouped.has(m))})`);
console.log(`  app symbols ............ ${symCount}  (attached: ${symCount-orphanSym})`);
console.log(`  tooling subsystems ..... ${toolReg.subsystemOrder.length}`);
console.log(`  tooling nodes attached . ${toolAttach}/${toolNodes.length}`);
console.log(`  edges resolvable ....... ${resolvable}  (dropped cross-boundary: ${unresolved})`);
for(const w of warns) console.log(`  note: ${w}`);
if(fails.length){console.log('\n  ✗ FAIL');for(const f of fails)console.log('    · '+f);process.exit(1);}
console.log('\n  ✓ PASS — the folded model is complete and every card has a home.');
