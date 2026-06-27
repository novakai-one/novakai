/* Headless reproduction of the flowmap wire-routing failure.
 *
 * Parses novakai.mmd geometry, then runs the REAL libavoid routeEdges with
 * three obstacle strategies to prove:
 *   1. box-only obstacles route fine (baseline)
 *   2. card-WIDE obstacles (current nodeFootprint behaviour) overlap heavily
 *      and throw / go very slow  -> the bug
 *   3. card-CLIPPED obstacles (proposed fix: keep card height, clip width
 *      to the node box) collapse the overlaps and route fine -> the fix
 *
 * Run: node tools/route-repro.mjs
 */
import { init, routeEdges } from '@mr_mint/elkjs-libavoid';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mmdPath = join(__dirname, '..', '.claude', 'worktrees', 'vigilant-pike-7136af', 'novakai.mmd');
const raw = readFileSync(mmdPath, 'utf8');

// ---- parse `%% fm <id> <x> <y> <w> <h> <shape> null` ----
const nodes = new Map();
for (const line of raw.split('\n')) {
  const m = line.match(/^%% fm (\S+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (\S+)/);
  if (!m) continue;
  const [, id, x, y, w, h, shape] = m;
  nodes.set(id, { id, x: +x, y: +y, w: +w, h: +h, shape });
}

// ---- parse edges (lines containing --> or -.->) ----
const edges = [];
for (const line of raw.split('\n')) {
  const m = line.match(/^\s*(\S+)\s*(?:-.->|-->)\s*(?:\|[^|]*\|)?\s*(\S+)/);
  if (!m) continue;
  const [, from, to] = m;
  if (!nodes.has(from) || !nodes.has(to)) continue;
  edges.push({ id: `e${edges.length}`, source: from, target: to });
}

// filter out edges touching group nodes (flowmark does this)
const isGroup = (id) => nodes.get(id).shape === 'group';
const routable = edges.filter((e) => !isGroup(e.source) && !isGroup(e.target));
const obstacles = [...nodes.values()].filter((n) => n.shape !== 'group');

console.log(`parsed: ${nodes.size} nodes (${obstacles.length} non-group obstacles), ${routable.length} routable edges`);

// ---- obstacle builders ----
const CARD_SPILL = 140;   // a frontmatter card is typically ~140px wider than its 160px box
const CARD_GAP = 6;
const CARD_H = 120;       // typical card height with several rows

function rectBox(n) { return { id: n.id, x: n.x, y: n.y, width: n.w, height: n.h }; }

// CURRENT behaviour (nodeFootprint): width = max(box, cardW), centered -> spills left & right
function rectCardWide(n) {
  const cw = n.w + CARD_SPILL;
  const w = Math.max(n.w, cw);
  const h = n.h + CARD_GAP + CARD_H;
  return { id: n.id, x: n.x - (w - n.w) / 2, y: n.y, width: w, height: h };
}

// PROPOSED FIX: keep full card HEIGHT (wire still avoids the card vertically),
// but clip obstacle WIDTH to the node box (no horizontal spill)
function rectCardClipped(n) {
  const h = n.h + CARD_GAP + CARD_H;
  return { id: n.id, x: n.x, y: n.y, width: n.w, height: h };
}

// count overlapping pairs after buffering by `buf`
function overlapCount(rects, buf) {
  const r = rects.map((x) => ({ x: x.x - buf, y: x.y - buf, w: x.width + 2 * buf, h: x.height + 2 * buf }));
  let n = 0;
  for (let i = 0; i < r.length; i++)
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) n++;
    }
  return n;
}

const OPTS = (buf) => ({
  routingType: 'orthogonal',
  shapeBufferDistance: buf,
  idealNudgingDistance: 16,
  nudgeOrthogonalSegmentsConnectedToShapes: true,
});

async function run(label, builder, buf) {
  const children = obstacles.map(builder);
  const graph = { id: 'root', children, edges: routable };
  const overlaps = overlapCount(children, buf);
  const t0 = performance.now();
  try {
    await init(); // node: auto-detected
    const routes = await routeEdges(graph, OPTS(buf));
    const dt = (performance.now() - t0).toFixed(0);
    console.log(`${label.padEnd(22)} buf=${buf}  overlaps=${String(overlaps).padStart(4)}  routes=${String(routes.size).padStart(3)}/${routable.length}  time=${dt}ms  OK`);
  } catch (err) {
    const dt = (performance.now() - t0).toFixed(0);
    console.log(`${label.padEnd(22)} buf=${buf}  overlaps=${String(overlaps).padStart(4)}  time=${dt}ms  THREW: ${String(err).slice(0, 90)}`);
  }
}

console.log('\n--- baseline: box-only obstacles (no frontmatter cards) ---');
await run('box-only', rectBox, 4);

console.log('\n--- CURRENT behaviour: card-WIDE obstacles (nodeFootprint spills horizontally) ---');
await run('card-wide (CURRENT)', rectCardWide, 4);
await run('card-wide (CURRENT)', rectCardWide, 2);
await run('card-wide (CURRENT)', rectCardWide, 0);

console.log('\n--- PROPOSED FIX: card-CLIPPED obstacles (full height, width = box) ---');
await run('card-clipped (FIX)', rectCardClipped, 4);
await run('card-clipped (FIX)', rectCardClipped, 2);
