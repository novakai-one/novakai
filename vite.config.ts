import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import novakaiFileBridge from './vite-file-bridge.mjs';

// ponytail: inline bridge — extract to tools/ide/pty-bridge.mjs (+ tooling-map
// node) when it outgrows ~150 lines or K10 needs to share it. SPEC_AGENTS §4.
const SESSION_RE = /^[A-Za-z0-9-]{1,64}$/;
const CONTRACT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const LOG_PATH = 'docs/novakai/metrics/agent-sessions.jsonl';

type PtySpawn = typeof import('node-pty').spawn;

interface SessionArgs {
  sock: WebSocket;
  spawn: PtySpawn;
  cwd: string;
  session: string;
  contract: string | null;
}

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
      let spawn: PtySpawn;
      try {
        ({ spawn } = await import('node-pty'));
      } catch (err) {
        server.config.logger.warn(
          `[novakai-pty-bridge] node-pty failed to load; /pty disabled (${err instanceof Error ? err.message : err})`,
        );
        return;
      }
      registerPty(server, spawn);
    },
  };
}

function originAllowed(server: ViteDevServer, origin: string | undefined): boolean {
  const addr = server.httpServer?.address();
  const port = addr && typeof addr === 'object' ? addr.port : null;
  const allowed = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
  ]);
  return origin !== undefined && allowed.has(origin);
}

function registerPty(server: ViteDevServer, spawn: PtySpawn): void {
  const wss = new WebSocketServer({ noServer: true });
  const cwd = process.cwd();

  server.httpServer?.on('upgrade', (req, socket, head) => {
    if (!req.url || new URL(req.url, 'http://localhost').pathname !== '/pty') return; // HMR's own ws falls through untouched
    if (!originAllowed(server, req.headers.origin)) return socket.destroy();
    const url = new URL(req.url, 'http://localhost');
    const session = url.searchParams.get('session') ?? '';
    const contract = url.searchParams.get('contract');
    if (!SESSION_RE.test(session) || (contract !== null && !CONTRACT_RE.test(contract))) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (sock) => {
      startSession({ sock, spawn, cwd, session, contract });
    });
  });
}

function spawnTerm(spawn: PtySpawn, cwd: string): ReturnType<PtySpawn> {
  const ptyCmd = process.env.NOVAKAI_PTY_CMD;
  const opts = { name: 'xterm-256color', cols: 80, rows: 24, cwd };
  return ptyCmd ? spawn('/bin/sh', ['-c', ptyCmd], opts) : spawn('claude', [], opts);
}

function logStart(args: SessionArgs, pid: number): void {
  const record: Record<string, unknown> = { event: 'start', session: args.session, cwd: args.cwd };
  if (args.contract !== null) record.contract = args.contract;
  record.pid = pid;
  record.time = new Date().toISOString();
  logEvent(record);
}

// one close per session, whatever exits first: the PTY (close the socket)
// or the socket (kill the PTY).
function exitCloser(sock: WebSocket, session: string): (exitCode: number | null) => void {
  let exited = false;
  return (exitCode) => {
    if (exited) return;
    exited = true;
    logEvent({ event: 'exit', session, exitCode: exitCode ?? null, time: new Date().toISOString() });
    try {
      sock.close(4000 + Math.min(exitCode ?? 0, 998), 'exit');
    } catch {
      // socket already closed
    }
  };
}

function asResize(msg: unknown): { cols: number; rows: number } | null {
  if (!msg || typeof msg !== 'object') return null;
  const rec = msg as { type?: unknown; cols?: unknown; rows?: unknown };
  if (rec.type !== 'resize' || typeof rec.cols !== 'number' || typeof rec.rows !== 'number') return null;
  return { cols: rec.cols, rows: rec.rows };
}

// raw PTY bytes end to end; the ONE structured message is resize.
function handleMessage(term: ReturnType<PtySpawn>, data: unknown): void {
  const text = String(data);
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    msg = null;
  }
  const resize = asResize(msg);
  if (resize) term.resize(resize.cols, resize.rows);
  else term.write(text);
}

function wireSession(sock: WebSocket, term: ReturnType<PtySpawn>, session: string): void {
  const onExit = exitCloser(sock, session);
  term.onData((data) => sock.send(data));
  term.onExit(({ exitCode }) => onExit(exitCode));
  sock.on('message', (data) => handleMessage(term, data));
  sock.on('close', () => {
    try {
      term.kill();
    } catch {
      // already dead
    }
  });
}

function startSession(args: SessionArgs): void {
  let term: ReturnType<PtySpawn>;
  try {
    term = spawnTerm(args.spawn, args.cwd);
  } catch {
    args.sock.close(4999, 'spawn');
    return;
  }
  logStart(args, term.pid);
  wireSession(args.sock, term, args.session);
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
