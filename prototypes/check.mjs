// Trusted, independent scorer. Loads the real graph, runs ONE layout's pure
// function, and recomputes the metrics with the shared metrics.mjs — so a
// layout author cannot fake numbers. Usage:  node check.mjs <name>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rootLevel } from './lib/graph.mjs';
import { metrics, PRINCIPLES } from './lib/metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) { console.error('usage: node check.mjs <layout-name>'); process.exit(1); }

const graph = JSON.parse(readFileSync(join(here, 'graph.json'), 'utf8'));
const { nodes, edges } = rootLevel(graph);

const mod = await import(join(here, 'layouts', name + '.mjs'));
if (typeof mod.layout !== 'function') { console.error(name + ' does not export layout()'); process.exit(1); }

const positions = mod.layout(nodes.map((n) => ({ ...n })), edges.map((e) => ({ ...e })));
const m = metrics(nodes, edges, positions);

console.log('# ' + (mod.title || name) + '  —  ' + (mod.principle || ''));
console.log(JSON.stringify(m, null, 0));
console.log('pass:', PRINCIPLES.map((p) => p.key + (p.target(m[p.key]) ? '✓' : '✗')).join(' '));
if (m.overlaps > 0) console.log('WARNING: ' + m.overlaps + ' node overlaps (boxes collide — not a valid pack)');
