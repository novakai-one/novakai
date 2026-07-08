import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface SessionOpts {
  host: HTMLElement;
  sessionId: string;
  contract: string | null;
  onStatus(status: 'exited' | 'disconnected' | 'spawn-failed' | 'bridge-broken', exitCode: number | null): void;
}

interface SessionHandle {
  pane: HTMLElement;
  activate(): void;
  dispose(): void;
}

// ponytail: theme is read once at construction, never re-applied on a live
// theme switch — upgrade path is a theming hook for pages to subscribe to
// (SPEC_AGENTS §11.5, accepted limitation).
function houseTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--bg').trim();
  const ink = cs.getPropertyValue('--ink').trim();
  return {
    background: bg,
    foreground: ink,
    cursor: '#7c8cff',
    cursorAccent: bg,
    selectionBackground: 'rgba(124,140,255,0.25)',
  };
}

function ptyUrl(sessionId: string, contract: string | null): string {
  const query = `session=${sessionId}${contract !== null ? `&contract=${contract}` : ''}`;
  return `ws://${location.host}/pty?${query}`;
}

function sendResize(ws: WebSocket, cols: number, rows: number): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

function writeDim(term: Terminal, line: string): void {
  term.write(`\r\n\x1b[2m${line}\x1b[22m\r\n`);
}

// server->client raw PTY bytes only; close code carries the only out-of-band
// signal (SPEC_AGENTS §4). No reconnect: the bridge already killed the PTY
// when the socket closed, so retrying cannot resurrect it (§11.2).
function wireIncoming(
  ws: WebSocket,
  term: Terminal,
  onStatus: SessionOpts['onStatus'],
): void {
  let sawByte = false;
  ws.onmessage = (ev): void => {
    sawByte = true;
    if (typeof ev.data === 'string') {
      term.write(ev.data);
    } else if (ev.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(ev.data));
    } else {
      void (ev.data as Blob).arrayBuffer().then((buf) => term.write(new Uint8Array(buf)));
    }
  };
  ws.onclose = (ev): void => {
    if (ev.code >= 4000 && ev.code <= 4998) {
      const exitCode = ev.code - 4000;
      writeDim(term, `[session exited · code ${exitCode}]`);
      onStatus('exited', exitCode);
    } else if (ev.code === 4999) {
      onStatus('spawn-failed', null);
    } else if (!sawByte) {
      // closed before any PTY byte: the bridge never answered (SPEC_AGENTS §8
      // bridge-broken) — distinct from a mid-session disconnect.
      onStatus('bridge-broken', null);
    } else {
      writeDim(term, '[bridge connection lost]');
      onStatus('disconnected', null);
    }
  };
}

export function createSession(opts: SessionOpts): SessionHandle {
  const { host, sessionId, contract, onStatus } = opts;

  const pane = document.createElement('div');
  pane.className = 'agents-pane';
  pane.style.display = 'none';
  host.appendChild(pane);

  const term = new Terminal({ scrollback: 5000, cursorBlink: false, theme: houseTheme() });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(pane);

  const ws = new WebSocket(ptyUrl(sessionId, contract));
  ws.binaryType = 'arraybuffer';
  wireIncoming(ws, term, onStatus);
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
  term.onResize(({ cols, rows }) => sendResize(ws, cols, rows));

  return {
    pane,
    activate(): void {
      pane.style.display = 'block';
      fitAddon.fit();
      term.focus();
      sendResize(ws, term.cols, term.rows);
    },
    // ponytail: reload kills sessions — no persistence, no restart (§11.1/§11.4).
    dispose(): void {
      ws.close();
      term.dispose();
      pane.remove();
    },
  };
}
