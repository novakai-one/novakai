import { defineConfig } from 'vite';
import novakaiAgentBridge from './vite-agent-bridge.mjs';
import novakaiFileBridge from './vite-file-bridge.mjs';

// base: './' keeps asset paths relative so the built app works from
// GitHub Pages, a file:// open, or any sub-path without reconfiguration.
export default defineConfig(({ command }) => ({
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
  // dev-only bridge from the Agents tab to a real `claude` CLI process;
  // CI must never spawn claude (see vite-agent-bridge.mjs).
  plugins: command === 'serve' && !process.env.CI ? [novakaiAgentBridge(), novakaiFileBridge()] : [],
}));
