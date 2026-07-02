/* =====================================================================
   parser-conformance.test.mjs — guard against the two-parser drift risk.

   flowmap has TWO Mermaid parsers that must stay in sync:
     • Pipeline: parseMmd()    in tools/buildspec/mmd-parse.mjs (Node 16+, JS)
     • App:      fromMermaid() in src/io/mermaid.ts             (TypeScript, browser)

   If they diverge, the in-app build-plan review surface shows one
   diagram while the gate / spec pipeline enforces a different one.

   ── Loading strategy for the app parser (src/io/mermaid.ts) ──────────
   Plain `node` cannot import .ts files because:
     (a) TypeScript syntax must be stripped, and
     (b) mermaid.ts uses extensionless relative imports
         (moduleResolution:"bundler") that plain Node ESM cannot resolve.

   We spawn a subprocess with:
     • --experimental-strip-types  (strips TS syntax; Node 22.6+)
     • a synchronous registerHooks resolve hook that appends .ts to
       extensionless relative imports, so Node finds the source files.

   The subprocess receives all corpus texts via stdin (JSON array of
   strings), calls fromMermaid() on each, and prints a JSON array of
   normalised {nodes, edges} results to stdout.

   If the subprocess succeeds (detected once at module load), the full
   cross-parser comparison tests run. If it fails — e.g. on an older
   Node or a platform that does not support --experimental-strip-types —
   those tests are test.skip()'d with a diagnostic message, and the file
   still exits 0.

   ── Always-on (Step 4 foundation) ─────────────────────────────────────
   Pipeline round-trip:
     parseMmd(toMmd(parseMmd(text))) must preserve real node IDs and
     edge keys. Groups (subgraphs) are intentionally excluded: toMmd()
     does not emit subgraph blocks (it serialises the extracted flat
     graph), so that loss is expected and tested via realNodeIds().

   ── App-parser comparison (Step 3) ────────────────────────────────────
   When the subprocess loads successfully, both parsers are run on:
     C1 — simple two-node graph
     C2 — graph with %% fm:meta frontmatter lines
     C3 — graph with a subgraph group
     C4 — all three edge styles (solid, dotted, thick) + %% kind lines
     docs/flowmap/_bundle.mmd — real 460-node bundle

   Comparison normalisation: for each text, assert that both parsers
   produce the same SORTED node-id set and the same SORTED edge-key set
   (where edge-key = "from|to|style"). Labels are not compared because
   parseMmd() does not store node labels (only IDs).

   Run: node --test tools/buildspec/parser-conformance.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseMmd, toMmd, realNodeIds } from './mmd-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BUNDLE_PATH = join(ROOT, 'docs', 'flowmap', '_bundle.mmd');
const MERMAID_TS_URL = pathToFileURL(join(ROOT, 'src', 'io', 'mermaid.ts')).href;

// ── Corpus ────────────────────────────────────────────────────────────────────

const C1 = `\
flowchart TD
  A["Alpha"]
  B["Beta"]
  C["Gamma"]
  A --> B
  B --> C
`;

const C2 = `\
flowchart LR
%% fm:meta nodeA name=Alpha Module
%% fm:meta nodeA desc=handles routing
%% fm:meta nodeA i0.name=init
%% fm:meta nodeA i0.accepts=ctx: AppContext
%% fm:meta nodeA i0.returns=Api
%% fm:meta nodeB name=Beta Module
  nodeA["Alpha"]
  nodeB["Beta"]
  nodeA --> nodeB
`;

// NOTE: C3 does NOT include an edge from the group node itself (grp --> outer).
// toMmd() intentionally drops subgraph blocks (it serialises the extracted flat
// graph). If a group-node appears in an edge, the round-trip re-creates it as a
// regular non-group node, which is expected — but that would make the round-trip
// assertion vacuously compare different things. Edges between leaf nodes (even
// ones nested inside the group) are preserved correctly across the round-trip.
const C3 = `\
flowchart TD
  subgraph grp ["Core Group"]
    inner["Inner Node"]
    other["Other Node"]
  end
  outer["Outer Node"]
  inner --> outer
  other -.-> outer
`;

const C4 = `\
flowchart LR
%% kind src component
%% kind mid function
%% kind dst store
  src["Source"]
  mid["Middle"]
  dst["Destination"]
  src --> mid
  mid -.-> dst
  src ==> dst
`;

// C5 exercises the %% group / %% group-member reading-mode grouping directives:
// declarations (flat + nested), memberships, and the pruning rules both parsers
// share (membership to an undeclared group and dangling group parents drop).
const C5 = `\
flowchart LR
%% group g_core "Domain model"
%% group g_canvas "Canvas" parent g_core
%% group g_ghost "Ghost" parent g_missing
%% group-member g_core state
%% group-member g_canvas render
%% group-member g_missing config
  state["State"]
  render["Render"]
  config["Config"]
  state --> render
`;

const CORPUS = [
  { name: 'simple graph',                text: C1 },
  { name: 'frontmatter',                 text: C2 },
  { name: 'subgraph groups',             text: C3 },
  { name: 'three edge styles and kinds', text: C4 },
  { name: 'grouping directives',         text: C5 },
];

// ── Normalisation helpers ─────────────────────────────────────────────────────

/**
 * Normalise a parseMmd() result for comparison.
 * Returns { nodeIds: string[], edgeKeys: string[] }.
 */
/** Normalise a hier overlay ({groups, memberOf}) into sorted comparable keys. */
function normHier(hier) {
  const groups = Object.values(hier?.groups ?? {})
    .map((g) => `${g.id}|${g.label}|${g.parent ?? ''}`)
    .sort();
  const members = Object.entries(hier?.memberOf ?? {})
    .map(([nid, gid]) => `${gid}|${nid}`)
    .sort();
  return { groups, members };
}

function normPipeline(model) {
  const nodeIds = Object.keys(model.nodes).sort();
  const edgeKeys = model.edges
    .map((e) => `${e.from}|${e.to}|${e.style}`)
    .sort();
  return { nodeIds, edgeKeys };
}

/**
 * Normalise a fromMermaid() result that has been serialised to plain JSON
 * by the subprocess (nodes are Record<id,{shape}>, edges are DiagramEdge[]).
 */
function normApp(item) {
  const nodeIds = Object.keys(item.nodes).sort();
  const edgeKeys = item.edges
    .map((e) => `${e.from}|${e.to}|${e.style}`)
    .sort();
  return { nodeIds, edgeKeys };
}

// ── App-parser subprocess code ────────────────────────────────────────────────

// This string is sent to a child process via:
//   node --experimental-strip-types --input-type=module -e <code>
// The child reads a JSON array of corpus texts from stdin, calls fromMermaid
// on each, and prints a JSON array of { ok, nodes, edges } objects to stdout.
//
// The registerHooks block adds a synchronous resolve hook that maps
// extensionless .ts imports (e.g. '../core/config/config') to their explicit
// file-URL counterparts (e.g. 'file:///…/src/core/config/config.ts').
// Without it, --experimental-strip-types alone cannot resolve those imports.

const TS_SUBPROCESS_CODE = `
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL && !/\\.[^./]+$/.test(specifier)) {
      const dir = fileURLToPath(new URL('.', context.parentURL));
      const tsPath = join(dir, specifier + '.ts');
      if (existsSync(tsPath)) return { shortCircuit: true, url: pathToFileURL(tsPath).href };
    }
    return nextResolve(specifier, context);
  },
});

const { fromMermaid } = await import(${JSON.stringify(MERMAID_TS_URL)});
const texts = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(texts.map((text) => {
  try {
    const r = fromMermaid(text);
    return {
      ok: true,
      nodes: Object.fromEntries(
        Object.entries(r.nodes).map(([id, n]) => [id, { shape: n.shape }]),
      ),
      edges: r.edges.map((e) => ({ from: e.from, to: e.to, style: e.style, label: e.label || '' })),
      hier: r.hier,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
})));
`;

/** Run the app parser via subprocess on an array of texts. Returns { ok, results } or { ok:false, error }. */
function runAppParser(texts) {
  const r = spawnSync(
    'node',
    ['--experimental-strip-types', '--input-type=module', '-e', TS_SUBPROCESS_CODE],
    { input: JSON.stringify(texts), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    return { ok: false, error: r.stderr || String(r.error || 'subprocess exited non-zero') };
  }
  try {
    return { ok: true, results: JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e.message}\nstdout: ${r.stdout.slice(0, 400)}` };
  }
}

// ── Pre-flight: attempt to load the app parser (runs once at module load) ─────

// AUD5/F-15 test seam: force the unavailable path so the strict-mode
// behaviour below is itself testable (conformance-strict.test.mjs).
const FORCED_UNAVAILABLE = !!process.env.FLOWMAP_FORCE_APP_UNAVAILABLE;
const CORPUS_RUN = FORCED_UNAVAILABLE
  ? { ok: false, error: 'forced unavailable (FLOWMAP_FORCE_APP_UNAVAILABLE)' }
  : runAppParser(CORPUS.map((c) => c.text));
const APP_AVAILABLE = CORPUS_RUN.ok;
// AUD5/F-15: "parsers PROVABLY agree" (A3) must not vacuously pass. In CI
// (GitHub Actions sets CI=true) an unavailable app parser is a FAILURE,
// not a skip; locally it stays a lenient skip (older Node etc.).
const STRICT_CONFORMANCE = process.env.CI === 'true' || process.env.CI === '1'
  || !!process.env.FLOWMAP_CONFORMANCE_STRICT;

// Read the bundle once; run it through the app parser only if the subprocess works.
const BUNDLE_TEXT  = readFileSync(BUNDLE_PATH, 'utf8');
const BUNDLE_RUN   = APP_AVAILABLE ? runAppParser([BUNDLE_TEXT]) : null;

// ── Pipeline round-trip tests — always run ────────────────────────────────────
//
// Validates pipeline-side stability: parseMmd(toMmd(parseMmd(text))) preserves
// the set of real (non-group) node IDs and all edge keys.
// Groups are excluded because toMmd() does not emit subgraph blocks; that loss
// is intentional (the serialiser targets the extracted flat graph, not the full
// bundle structure). realNodeIds() from mmd-parse.mjs filters groups out.

for (const { name, text } of CORPUS) {
  test(`[pipeline-roundtrip] ${name}: real node IDs and edges survive toMmd → parseMmd`, () => {
    const first  = parseMmd(text);
    const second = parseMmd(toMmd(first));

    assert.deepEqual(
      realNodeIds(second).sort(),
      realNodeIds(first).sort(),
      'real node id set must survive round-trip',
    );
    assert.deepEqual(
      second.edges.map((e) => `${e.from}|${e.to}|${e.style}`).sort(),
      first.edges.map((e)  => `${e.from}|${e.to}|${e.style}`).sort(),
      'edge set must survive round-trip',
    );
    assert.deepEqual(
      normHier(second.hier),
      normHier(first.hier),
      '%% group hier overlay must survive round-trip',
    );
  });
}

test('[pipeline-roundtrip] _bundle.mmd: real node IDs and edges survive toMmd → parseMmd', () => {
  const first  = parseMmd(BUNDLE_TEXT);
  const second = parseMmd(toMmd(first));

  assert.deepEqual(
    realNodeIds(second).sort(),
    realNodeIds(first).sort(),
    '_bundle.mmd real node id set must survive round-trip',
  );
  assert.deepEqual(
    second.edges.map((e) => `${e.from}|${e.to}|${e.style}`).sort(),
    first.edges.map((e)  => `${e.from}|${e.to}|${e.style}`).sort(),
    '_bundle.mmd edge set must survive round-trip',
  );
});

// ── App-parser comparison tests ───────────────────────────────────────────────
//
// These run only when the subprocess loaded successfully.  If not, a single
// test.skip() explains the blocker and the file still exits 0.

if (!APP_AVAILABLE) {
  // NOTE: The app parser subprocess failed.  Requirements:
  //   • Node 22.6+ (for --experimental-strip-types)
  //   • The registerHooks API (added in Node 23.5 for synchronous hooks)
  //   Current Node: ${process.version}
  // What IS covered: pipeline round-trip stability (parseMmd + toMmd).
  // What is NOT covered: cross-parser agreement (parseMmd vs fromMermaid).
  const diag = (CORPUS_RUN.error || '').slice(0, 180).replace(/\n/g, ' ');
  if (STRICT_CONFORMANCE) {
    // F-15: in CI a silent skip would let "parsers provably agree" go green
    // without ever comparing the parsers — fail loud instead.
    test('[app-vs-pipeline] app parser MUST load under CI/strict — conformance cannot vacuously pass', () => {
      assert.fail(
        `A3 two-parser conformance did not run: the app-parser subprocess failed under strict/CI mode.\n` +
        `Node: ${process.version}\nError: ${diag}`,
      );
    });
  } else {
    console.log(
      `  NOTE [app-vs-pipeline]: app parser subprocess failed — comparison tests skipped.\n` +
      `  Node: ${process.version}  Error excerpt: ${diag}`,
    );
    test.skip('[app-vs-pipeline] app parser not loadable — cross-parser comparison skipped', () => {});
  }
} else {
  // ── Corpus: compare parsers on each inline test case ──────────────────────
  for (let i = 0; i < CORPUS.length; i++) {
    const { name, text } = CORPUS[i];
    const item = CORPUS_RUN.results[i];

    test(`[app-vs-pipeline] ${name}: node-id sets agree`, () => {
      assert.ok(item?.ok, `fromMermaid threw for "${name}": ${item?.error}`);
      const pNorm = normPipeline(parseMmd(text));
      const aNorm = normApp(item);
      assert.deepEqual(
        aNorm.nodeIds,
        pNorm.nodeIds,
        `node-id sets diverge for "${name}":\n` +
        `  app:      ${JSON.stringify(aNorm.nodeIds)}\n` +
        `  pipeline: ${JSON.stringify(pNorm.nodeIds)}`,
      );
    });

    test(`[app-vs-pipeline] ${name}: edge sets agree (from, to, style)`, () => {
      assert.ok(item?.ok, `fromMermaid threw for "${name}": ${item?.error}`);
      const pNorm = normPipeline(parseMmd(text));
      const aNorm = normApp(item);
      assert.deepEqual(
        aNorm.edgeKeys,
        pNorm.edgeKeys,
        `edge sets diverge for "${name}":\n` +
        `  app:      ${JSON.stringify(aNorm.edgeKeys)}\n` +
        `  pipeline: ${JSON.stringify(pNorm.edgeKeys)}`,
      );
    });

    test(`[app-vs-pipeline] ${name}: %% group hier overlays agree`, () => {
      assert.ok(item?.ok, `fromMermaid threw for "${name}": ${item?.error}`);
      const pHier = normHier(parseMmd(text).hier);
      const aHier = normHier(item.hier);
      assert.deepEqual(aHier, pHier,
        `hier overlays diverge for "${name}":\n` +
        `  app:      ${JSON.stringify(aHier)}\n` +
        `  pipeline: ${JSON.stringify(pHier)}`);
    });
  }

  // ── Real-world bundle: the most important cross-parser check ──────────────
  // The bundle is 460 nodes / 281 edges and exercises frontmatter, kinds,
  // groups, and all edge styles.  A divergence here would silently corrupt
  // the in-app build-plan review.

  test('[app-vs-pipeline] _bundle.mmd: node-id sets agree', () => {
    assert.ok(BUNDLE_RUN?.ok, `bundle subprocess failed: ${BUNDLE_RUN?.error}`);
    const item = BUNDLE_RUN.results[0];
    assert.ok(item?.ok, `fromMermaid threw on bundle: ${item?.error}`);
    const pNorm = normPipeline(parseMmd(BUNDLE_TEXT));
    const aNorm = normApp(item);
    assert.deepEqual(
      aNorm.nodeIds,
      pNorm.nodeIds,
      `bundle: node-id sets diverge — app: ${aNorm.nodeIds.length} nodes, pipeline: ${pNorm.nodeIds.length} nodes`,
    );
  });

  test('[app-vs-pipeline] _bundle.mmd: edge sets agree (from, to, style)', () => {
    assert.ok(BUNDLE_RUN?.ok, `bundle subprocess failed: ${BUNDLE_RUN?.error}`);
    const item = BUNDLE_RUN.results[0];
    assert.ok(item?.ok, `fromMermaid threw on bundle: ${item?.error}`);
    const pNorm = normPipeline(parseMmd(BUNDLE_TEXT));
    const aNorm = normApp(item);
    assert.deepEqual(
      aNorm.edgeKeys,
      pNorm.edgeKeys,
      `bundle: edge sets diverge — app: ${aNorm.edgeKeys.length} edges, pipeline: ${pNorm.edgeKeys.length} edges`,
    );
  });
}
