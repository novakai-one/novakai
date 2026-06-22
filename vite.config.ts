import { defineConfig } from 'vite';

// base: './' keeps asset paths relative so the built app works from
// GitHub Pages, a file:// open, or any sub-path without reconfiguration.
export default defineConfig({
  base: './',
  // libavoid ships an Emscripten WASM module; pre-bundling it breaks the
  // loader, so leave both packages unbundled in dev.
  optimizeDeps: {
    exclude: ['@mr_mint/elkjs-libavoid', 'libavoid-js'],
  },
  build: {
    outDir: 'dist',
    target: 'es2021',
  },
});
