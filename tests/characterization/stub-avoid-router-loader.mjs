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
   ===================================================================== */

export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes('render/avoidRouter')) {
    return { url: 'stub:avoid-router', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === 'stub:avoid-router') {
    return {
      format: 'module',
      source: 'export async function routeReferences() { return; }',
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
