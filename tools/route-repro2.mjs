/* Reproduce the ACTUAL failure at higher density + scale.
 *
 * Two experiments:
 *  A) Scale novakai geometry 3x by tiling (-> ~180 obstacles, ~280 edges),
 *     packing tiles to keep density. Compare card-wide vs card-clipped.
 *  B) A synthetic "vertical column" graph that mimics the user's symptom:
 *     nodes stacked in a tight N-S column with wide frontmatter cards, edges
 *     connecting non-adjacent nodes so wires must pass intermediate nodes.
 *
 * Run: node tools/route-repro2.mjs
 */
import { init, routeEdges } from '@mr_mint/elkjs-libavoid';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, '..', '.claude', 'worktrees', 'vigilant-pike-7136af', 'novakai.mmd'), 'utf8');

const nodes = new Map();
for (const line of raw.split('\n')) {
  const m = line.match(/^%% fm (\S+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (\S+)/);
  if (!m) continue;
  nodes.set(m[1], { id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5], shape: m[6] });
}
const baseEdges = [];
for (const line of raw.split('\n')) {
  const m = line.match(/^\s*(\S+)\s*(?:-.->|-->)\s*(?:\|[^|]*\|)?\s*(\S+)/);
  if (!m) continue;
  if (!nodes.has(m[1]) || !nodes.has(m[2])) continue;
  baseEdges.push({ from: m[1], to: m[2] });
}
const isGroup = (id) => nodes.get(id).shape === 'group';

// ---- Experiment A: tile 3x, packing tiles vertically with overlap ----
function buildTiled(times) {
  const obs = [];
  const eds = [];
  const nonGroup = [...nodes.values()].filter((n) => n.shape !== 'group');
  const routableBase = baseEdges.filter((e) => !isGroup(e.from) && !isGroup(e.to));
  const YSTEP = 2600; // pack tiles close (novakai is ~2500 tall) -> keep density
  for (let t = 0; t < times; t++) {
    const dy = t * YSTEP;
    for (const n of nonGroup) obs.push({ id: `${n.id}__${t}`, x: n.x, y: n.y + dy, w: n.w, h: n.h });
    for (let i = 0; i < routableBase.length; i++)
      eds.push({ id: `e${t}_${i}`, source: `${routableBase[i].from}__${t}`, target: `${routableBase[i].to}__${t}` });
  }
  return { obs, eds };
}

const CARD_SPILL = 140, CARD_GAP = 6, CARD_H = 120;
const wide = (n) => { const w = Math.max(n.w, n.w + CARD_SPILL); return { id: n.id, x: n.x - (w - n.w) / 2, y: n.y, width: w, height: n.h + CARD_GAP + CARD_H }; };
const clipped = (n) => ({ id: n.id, x: n.x, y: n.y, width: n.w, height: n.h + CARD_GAP + CARD_H });

function overlaps(rects, buf) {
  const r = rects.map((x) => ({ x: x.x - buf, y: x.y - buf, w: x.width + 2 * buf, h: x.height + 2 * buf }));
  let n = 0;
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) { const a = r[i], b = r[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) n++; }
  return n;
}
const OPTS = (buf) => ({ routingType: 'orthogonal', shapeBufferDistance: buf, idealNudgingDistance: 16, nudgeOrthogonalSegmentsConnectedToShapes: true });

async function run(label, obs, eds, builder, buf) {
  const children = obs.map(builder);
  const graph = { id: 'root', children, edges: eds };
  const ov = overlaps(children, buf);
  const t0 = performance.now();
  try {
    await init();
    const routes = await routeEdges(graph, OPTS(buf));
    const dt = (performance.now() - t0).toFixed(0);
    console.log(`${label.padEnd(26)} obstacles=${String(children.length).padStart(4)} edges=${String(eds.length).padStart(4)} overlaps=${String(ov).padStart(4)} routes=${String(routes.size).padStart(4)}/${eds.length} time=${dt}ms OK`);
  } catch (err) {
    const dt = (performance.now() - t0).toFixed(0);
    console.log(`${label.padEnd(26)} obstacles=${String(children.length).padStart(4)} edges=${String(eds.length).padStart(4)} overlaps=${String(ov).padStart(4)} time=${dt}ms THREW: ${String(err).slice(0, 80)}`);
  }
}

console.log('=== Experiment A: tiled novakai x3 (~186 obstacles, ~280 edges), buf=4 ===');
{ const { obs, eds } = buildTiled(3);
  await run('card-wide (CURRENT)', obs, eds, wide, 4);
  await run('card-clipped (FIX)', obs, eds, clipped, 4);
}

console.log('\n=== Experiment B: synthetic vertical column (mimics user symptom) ===');
// 70 nodes stacked N-S, wide cards -> a wire from top to bottom must dodge 68 nodes
{
  const obs = []; const eds = [];
  const N = 70;
  for (let i = 0; i < N; i++) obs.push({ id: `n${i}`, x: 688, y: 100 + i * 90, w: 160, h: 56 });
  // long-range edges: every 5th node to a node 20 down -> wires travel past many nodes
  for (let i = 0; i + 20 < N; i += 5) eds.push({ id: `e${eds.length}`, source: `n${i}`, target: `n${i + 20}` });
  // plus a couple of very long ones
  eds.push({ id: `e${eds.length}`, source: `n0`, target: `n${N - 1}` });
  await run('card-wide (CURRENT)', obs, eds, wide, 4);
  await run('card-clipped (FIX)', obs, eds, clipped, 4);
}
