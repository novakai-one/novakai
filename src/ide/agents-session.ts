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
  const computedStyle = getComputedStyle(document.documentElement);
  const background = computedStyle.getPropertyValue('--bg').trim();
  const ink = computedStyle.getPropertyValue('--ink').trim();
  return {
    background,
    foreground: ink,
    cursor: '#7c8cff',
    cursorAccent: background,
    selectionBackground: 'rgba(124,140,255,0.25)',
  };
}

function ptyUrl(sessionId: string, contract: string | null): string {
  const query = `session=${sessionId}${contract !== null ? `&contract=${contract}` : ''}`;
  return `ws://${location.host}/pty?${query}`;
}

function sendResize(socket: WebSocket, cols: number, rows: number): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

function writeDim(term: Terminal, line: string): void {
  term.write(`\r\n\x1b[2m${line}\x1b[22m\r\n`);
}

function writeIncomingData(term: Terminal, data: string | ArrayBuffer | Blob): void {
  if (typeof data === 'string') {
    term.write(data);
  } else if (data instanceof ArrayBuffer) {
    term.write(new Uint8Array(data));
  } else {
    void data.arrayBuffer().then((buf) => term.write(new Uint8Array(buf)));
  }
}

function handleSocketClose(
  term: Terminal,
  event: CloseEvent,
  sawByte: boolean,
  onStatus: SessionOpts['onStatus'],
): void {
  if (event.code >= 4000 && event.code <= 4998) {
    const exitCode = event.code - 4000;
    writeDim(term, `[session exited · code ${exitCode}]`);
    onStatus('exited', exitCode);
  } else if (event.code === 4999) {
    onStatus('spawn-failed', null);
  } else if (!sawByte) {
    // closed before any PTY byte: the bridge never answered (SPEC_AGENTS §8
    // bridge-broken) — distinct from a mid-session disconnect.
    onStatus('bridge-broken', null);
  } else {
    writeDim(term, '[bridge connection lost]');
    onStatus('disconnected', null);
  }
}

// server->client raw PTY bytes only; close code carries the only out-of-band
// signal (SPEC_AGENTS §4). No reconnect: the bridge already killed the PTY
// when the socket closed, so retrying cannot resurrect it (§11.2).
function wireIncoming(
  socket: WebSocket,
  term: Terminal,
  onStatus: SessionOpts['onStatus'],
): void {
  let sawByte = false;
  socket.onmessage = (event): void => {
    sawByte = true;
    writeIncomingData(term, event.data);
  };
  socket.onclose = (event): void => handleSocketClose(term, event, sawByte, onStatus);
}

function createPane(host: HTMLElement): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'agents-pane';
  pane.style.display = 'none';
  host.appendChild(pane);
  return pane;
}

function createTerminal(pane: HTMLElement): { term: Terminal; fitAddon: FitAddon } {
  const term = new Terminal({ scrollback: 5000, cursorBlink: false, theme: houseTheme() });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(pane);
  return { term, fitAddon };
}

function buildHandle(pane: HTMLElement, term: Terminal, fitAddon: FitAddon, socket: WebSocket): SessionHandle {
  return {
    pane,
    activate(): void {
      pane.style.display = 'block';
      fitAddon.fit();
      term.focus();
      sendResize(socket, term.cols, term.rows);
    },
    // ponytail: reload kills sessions — no persistence, no restart (§11.1/§11.4).
    dispose(): void {
      socket.close();
      term.dispose();
      pane.remove();
    },
  };
}

export function createSession(opts: SessionOpts): SessionHandle {
  const { host, sessionId, contract, onStatus } = opts;
  const pane = createPane(host);
  const { term, fitAddon } = createTerminal(pane);

  const socket = new WebSocket(ptyUrl(sessionId, contract));
  socket.binaryType = 'arraybuffer';
  wireIncoming(socket, term, onStatus);
  term.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  });
  term.onResize(({ cols, rows }) => sendResize(socket, cols, rows));

  return buildHandle(pane, term, fitAddon, socket);
}
