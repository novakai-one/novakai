import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import novakaiFileBridge from './vite-file-bridge.mjs';

// ponytail: inline bridge — extract to tools/ide/pty-bridge.mjs (+ tooling-map
// node) when it outgrows ~150 lines or K10 needs to share it. SPEC_AGENTS §4.
const SESSION_RE = /^[A-Za-z0-9-]{1,64}$/;
const CONTRACT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const LOG_PATH = 'docs/novakai/metrics/agent-sessions.jsonl';

function logEvent(record: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
  } catch {
    // best-effort log; never block the bridge on a filesystem failure
  }
}

// dev-only PTY bridge: real `claude` in a real terminal over ws://.../pty.
// Node stdlib + ws + node-pty only. Never registered on `vite build`.
function novakaiPtyBridge(): Plugin {
  return {
    name: 'novakai-pty-bridge',
    async configureServer(server) {
      let spawn: typeof import('node-pty').spawn;
      try {
        ({ spawn } = await import('node-pty'));
      } catch (err) {
        server.config.logger.warn(
          `[novakai-pty-bridge] node-pty failed to load; /pty disabled (${err instanceof Error ? err.message : err})`,
        );
        return;
      }

      const wss = new WebSocketServer({ noServer: true });
      const cwd = process.cwd();

      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url || new URL(req.url, 'http://localhost').pathname !== '/pty') return; // HMR's own ws falls through untouched

        const addr = server.httpServer?.address();
        const port = addr && typeof addr === 'object' ? addr.port : null;
        const allowedOrigins = new Set([
          `http://localhost:${port}`,
          `http://127.0.0.1:${port}`,
          `http://[::1]:${port}`,
        ]);
        const origin = req.headers.origin;
        if (!origin || !allowedOrigins.has(origin)) {
          socket.destroy();
          return;
        }

        const url = new URL(req.url, 'http://localhost');
        const session = url.searchParams.get('session') ?? '';
        const contract = url.searchParams.get('contract');
        if (!SESSION_RE.test(session) || (contract !== null && !CONTRACT_RE.test(contract))) {
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          startSession(ws, spawn, cwd, session, contract);
        });
      });
    },
  };
}

function startSession(
  ws: WebSocket,
  spawn: typeof import('node-pty').spawn,
  cwd: string,
  session: string,
  contract: string | null,
): void {
  const ptyCmd = process.env.NOVAKAI_PTY_CMD;
  let term;
  try {
    term = ptyCmd
      ? spawn('/bin/sh', ['-c', ptyCmd], { name: 'xterm-256color', cols: 80, rows: 24, cwd })
      : spawn('claude', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd });
  } catch {
    ws.close(4999, 'spawn');
    return;
  }

  const startRecord: Record<string, unknown> = { event: 'start', session, cwd };
  if (contract !== null) startRecord.contract = contract;
  startRecord.pid = term.pid;
  startRecord.ts = new Date().toISOString();
  logEvent(startRecord);

  let exited = false;
  const onExit = (exitCode: number | null): void => {
    if (exited) return;
    exited = true;
    logEvent({ event: 'exit', session, exitCode: exitCode ?? null, ts: new Date().toISOString() });
    try {
      ws.close(4000 + Math.min(exitCode ?? 0, 998), 'exit');
    } catch {
      // socket already closed
    }
  };

  term.onData((data) => ws.send(data));
  term.onExit(({ exitCode }) => onExit(exitCode));

  ws.on('message', (data) => {
    const text = data.toString();
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      msg = null;
    }
    if (
      msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'resize' &&
      typeof (msg as { cols?: unknown }).cols === 'number' && typeof (msg as { rows?: unknown }).rows === 'number'
    ) {
      term.resize((msg as { cols: number }).cols, (msg as { rows: number }).rows);
    } else {
      term.write(text);
    }
  });

  ws.on('close', () => {
    try {
      term.kill();
    } catch {
      // already dead
    }
  });
}

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
  // PTY bridge (SPEC_AGENTS §4) must be live in every dev + e2e run, incl.
  // CI; the file bridge is dev-convenience only and stays out of CI.
  plugins: command === 'serve' ? [novakaiPtyBridge(), ...(!process.env.CI ? [novakaiFileBridge()] : [])] : [],
}));
