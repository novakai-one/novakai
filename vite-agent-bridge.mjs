// vite-agent-bridge.mjs — dev-only Vite plugin: bridges the Agents tab to a
// real `claude` CLI process over Vite's own HMR websocket + middlewares.
// Node stdlib only, no new deps. Never registered in CI (wired in
// vite.config.ts: command === 'serve' && !process.env.CI).
//
// ponytail: everything below the pure-function section is disk/process I/O
// and is intentionally untested directly — the pure cores are unit-tested,
// the wiring is exercised by hand in the dev app (see plan k6-bridge A7).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_CHILDREN = 3;
const REGISTRY_PATH = join(homedir(), '.claude', 'novakai-bridge-sessions.json');

export const SPAWN_ARGS = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode', 'acceptEdits',
];

// ---------------------------------------------------------------------
// Pure functions — unit-tested directly, no FS/process/socket involved.
// ---------------------------------------------------------------------

export function slugFor(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function frameUserLine(text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  }) + '\n';
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const block = content.find((b) => b && b.type === 'text');
    return block ? block.text : '';
  }
  return '';
}

// Parses one session's ~/.claude/projects/<slug>/<id>.jsonl content.
// Drops isSidechain lines (subagent/orchestration transcripts) so they
// never leak into a session's title or history.
export function parseSessionLines(jsonlText) {
  let title = '';
  let ts = '';
  const messages = [];
  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.isSidechain) continue;
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    if (!title && obj.type === 'user') {
      title = extractText(obj.message && obj.message.content);
      ts = obj.timestamp || '';
    }
    messages.push({ role: obj.message && obj.message.role, content: obj.message && obj.message.content, ts: obj.timestamp || '' });
  }
  return { title, ts, messages };
}

// history id must exactly match a registry-listed session — never
// interpolated into a path, so this is the only gate a lookup passes through.
export function validHistoryId(id, knownIds) {
  return typeof id === 'string' && id.length > 0 && knownIds.includes(id);
}

export function sessionIdsForCwd(registry, cwd) {
  return (registry && registry[cwd]) || [];
}

export function appendSessionToRegistry(registry, cwd, sessionId) {
  const list = sessionIdsForCwd(registry, cwd);
  if (list.includes(sessionId)) return registry;
  return { ...registry, [cwd]: [...list, sessionId] };
}

// ---------------------------------------------------------------------
// I/O wrappers — thin, deliberately untested here.
// ---------------------------------------------------------------------

function readRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function recordSession(cwd, sessionId) {
  const next = appendSessionToRegistry(readRegistry(), cwd, sessionId);
  writeFileSync(REGISTRY_PATH, JSON.stringify(next));
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// ---------------------------------------------------------------------
// The plugin.
// ---------------------------------------------------------------------

export default function novakaiAgentBridge() {
  const cwd = process.cwd();
  const projectDir = join(homedir(), '.claude', 'projects', slugFor(cwd));
  const children = new Map(); // sessionId -> child process

  function sessionFile(id) {
    return join(projectDir, `${id}.jsonl`);
  }

  function knownIds() {
    return sessionIdsForCwd(readRegistry(), cwd);
  }

  // SIGKILL, not SIGTERM: the CLI can shrug off SIGTERM mid-hook, and an
  // orphan surviving a vite restart holds a concurrency slot forever
  function killChild(sessionId) {
    const entry = children.get(sessionId);
    if (entry) entry.proc.kill('SIGKILL');
    children.delete(sessionId);
  }

  // One booting-or-booted child not yet owned by any ws client. This repo's
  // SessionStart hook (novakai:onboard) makes a cold child take ~3 minutes
  // before its first byte — so we start one the moment the Agents tab shows
  // any activity, and the first send attaches to it instead of cold-spawning.
  let prewarmed = null;

  function spawnChild(resumeId) {
    const args = resumeId ? [...SPAWN_ARGS, '--resume', resumeId] : SPAWN_ARGS;
    const entry = {
      proc: spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }),
      sessionId: resumeId || null,
      owner: null,
      buf: '',
    };
    entry.proc.stdout.on('data', (chunk) => {
      entry.buf += chunk.toString();
      let idx;
      while ((idx = entry.buf.indexOf('\n')) !== -1) {
        const line = entry.buf.slice(0, idx);
        entry.buf = entry.buf.slice(idx + 1);
        if (!line.trim()) continue;
        if (!entry.sessionId) {
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
              entry.sessionId = evt.session_id;
              children.set(entry.sessionId, entry);
              recordSession(cwd, entry.sessionId);
            }
          } catch {
            // not JSON — forward as-is below
          }
        }
        // delivered to the owning client only — a session's stream has
        // exactly one owner (the page that sent into it most recently)
        if (entry.owner) entry.owner.send('novakai:agent:evt', { sessionId: entry.sessionId, line });
      }
    });
    entry.proc.on('exit', () => {
      if (entry.sessionId) children.delete(entry.sessionId);
      if (prewarmed === entry) prewarmed = null;
    });
    entry.proc.on('error', () => {
      if (prewarmed === entry) prewarmed = null;
    });
    return entry;
  }

  return {
    name: 'novakai-agent-bridge',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/novakai/agent/sessions') {
          if (!isLoopback(req)) { res.statusCode = 403; return res.end(); }
          if (!prewarmed && children.size < MAX_CHILDREN) prewarmed = spawnChild(null);
          const list = knownIds()
            .map((id, i) => {
              const path = sessionFile(id);
              if (!existsSync(path)) return null;
              const { title, ts } = parseSessionLines(readFileSync(path, 'utf8'));
              return { id, title: title || `novakai ${i + 1}`, ts };
            })
            .filter(Boolean)
            .reverse();
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify(list));
        }

        if (url.pathname === '/novakai/agent/history') {
          if (!isLoopback(req)) { res.statusCode = 403; return res.end(); }
          const id = url.searchParams.get('id') || '';
          if (!validHistoryId(id, knownIds())) { res.statusCode = 404; return res.end(); }
          const path = sessionFile(id);
          if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
          const { messages } = parseSessionLines(readFileSync(path, 'utf8'));
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify(messages));
        }

        next();
      });

      server.ws.on('novakai:agent:send', (data, client) => {
        // instant ack: the client's offline notice must only ever fire when
        // the bridge is truly absent, not when a first child spawn is slow
        client.send('novakai:agent:evt', {
          sessionId: (data && data.sessionId) || null,
          line: JSON.stringify({ type: 'ack' }),
        });
        // no kill-on-disconnect: the HMR socket recycles during long child
        // boots and a reconnect must never kill an in-flight turn; children
        // die on server close or displacement by the cap
        const text = data && data.text;
        if (typeof text !== 'string' || !text.trim()) return;
        const sessionId = (data && data.sessionId) || null;

        let entry = sessionId ? children.get(sessionId) : null;
        if (!entry && !sessionId && prewarmed) {
          entry = prewarmed;
          prewarmed = null;
        }
        if (!entry) {
          if (children.size >= MAX_CHILDREN) {
            client.send('novakai:agent:evt', {
              sessionId,
              line: JSON.stringify({ type: 'error', error: 'too many concurrent agent sessions' }),
            });
            return;
          }
          entry = spawnChild(sessionId);
        }
        entry.owner = client; // (re)attach — a reloaded page re-owns its stream on next send
        try {
          entry.proc.stdin.write(frameUserLine(text));
        } catch {
          // child died between lookup and write; its exit handler reaped it
        }
      });

      server.httpServer?.on('close', () => {
        for (const id of children.keys()) killChild(id);
      });
    },
  };
}
