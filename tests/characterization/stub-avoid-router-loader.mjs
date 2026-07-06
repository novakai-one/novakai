/* =====================================================================
   stub-avoid-router-loader.mjs — test-only module loader hook
   ---------------------------------------------------------------------
   src/io/layout.ts imports routeReferences from src/render/avoidRouter.ts,
   which does `import wasmUrl from './libavoid.wasm?url'` (a Vite-only
   asset import). Under the plain `node --import tsx` test runtime (no
   bundler) that import crashes at MODULE LOAD TIME, before any layout
   code runs: `Cannot find package 'env' imported from .../libavoid.wasm`.

   This is unrelated to the logic under test (autoLayout never inspects
   routeReferences's return value; it only awaits the side effect after
   all positioning is already computed). This loader intercepts the
   specifier so layout.ts's REAL, unmodified code loads and runs; only the
   external WASM router collaborator is replaced with a no-op stand-in,
   exactly like the fake ctx/hooks below stand in for the DOM.

   src/render/wires.ts imports routeFor/obstacleSignature/ensureRoutes from
   the same module for its (pure, DOM-free) path-geometry helpers
   (orthoPath/polyPath/midOf/labelAnchor). Those helpers never call the
   three functions below — they're only reachable through drawWiresImpl,
   which the geometry-only characterization tests never invoke — so the
   no-op stand-ins here just need to satisfy the import, not do anything.
   ===================================================================== */

export async function resolve(specifier, context, nextResolve) {
  // io/layout.ts imports '../render/avoidRouter'; render/wires.ts (already
  // inside render/) imports the sibling-relative './avoidRouter' — match
  // on the module's own name so both specifier shapes are caught.
  if (specifier.includes('avoidRouter')) {
    return { url: 'stub:avoid-router', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'stub:avoid-router') {
    return {
      format: 'module',
      source: 'export async function routeReferences() { return; }\n'
        + 'export function routeFor() { return null; }\n'
        + 'export function obstacleSignature() { return \'\'; }\n'
        + 'export function ensureRoutes() {}\n',
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
