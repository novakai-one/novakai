// vite-file-bridge.mjs — dev-only Vite plugin: serves the top-level
// designs/ folder to the Design tab, and the top-level contracts/ folder to
// the Contracts tab, over plain HTTP. Node stdlib only, no new deps. Never
// registered in CI (wired in vite.config.ts: command === 'serve' &&
// !process.env.CI), and every endpoint is loopback-only — this is a
// filesystem-write trust boundary, not just a dev convenience.
//
// Endpoints:
//   GET  /novakai/designs         list design names
//   GET  /novakai/designs/read    read one design by name
//   POST /novakai/designs/write   write one design by name
//   GET  /novakai/contracts       list contract records
//   POST /novakai/contracts/write write one contract record by id

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// ---------------------------------------------------------------------
// Pure functions — unit-tested directly, no FS/process/socket involved.
// ---------------------------------------------------------------------

export function safeName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+$/.test(name) ? name : null;
}

// containment: resolve then verify the resolved path stays INSIDE designsDir.
// checked against designsDir + sep, never a bare startsWith(designsDir) —
// that admits a sibling `designs-evil`.
export function designPath(designsDir, name) {
  const clean = safeName(name);
  if (clean === null) return null;
  const p = resolve(designsDir, clean + '.design.mmd'); // extension appended SERVER-side, never trusted from client
  return p.startsWith(resolve(designsDir) + sep) ? p : null;
}

const CONTRACT_STATUSES = new Set(['draft', 'active', 'review', 'completed']);

// FROZEN API: field checks below are load-bearing for both the write
// endpoint and the app that posts to it — do not add/relax fields here
// without updating both sides.
export function validateContractRecord(record) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return 'record must be an object';
  }
  if (record.v !== 1) return 'record.v must be 1';
  if (typeof record.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(record.id)) {
    return 'record.id must match ^[a-z0-9][a-z0-9-]*$';
  }
  if (!CONTRACT_STATUSES.has(record.status)) {
    return 'record.status must be one of draft, active, review, completed';
  }
  if (typeof record.title !== 'string') return 'record.title must be a string';
  return null;
}

// containment: same pattern as designPath — resolve then verify the
// resolved path stays INSIDE contractsDir. record.id is already
// regex-checked by validateContractRecord, but this stays a belt-and-braces
// containment check, not a trust shortcut.
export function contractPath(contractsDir, id) {
  const p = resolve(contractsDir, id + '.contract.json');
  return p.startsWith(resolve(contractsDir) + sep) ? p : null;
}

// ---------------------------------------------------------------------
// I/O wrappers.
// ---------------------------------------------------------------------

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readBody(req) {
  return new Promise((done, fail) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => done(data));
    req.on('error', fail);
  });
}

// a file that fails to parse or isn't a JSON object is SKIPPED — the list
// endpoint never 500s for one bad contract file.
function listContracts(contractsDir) {
  const files = readdirSync(contractsDir).filter((f) => f.endsWith('.contract.json'));
  const records = [];
  for (const f of files) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(contractsDir, f), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed);
    } catch {
      // skip: unparsable or malformed contract file
    }
  }
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return records;
}

// ---------------------------------------------------------------------
// The plugin.
// ---------------------------------------------------------------------

export default function novakaiFileBridge() {
  const designsDir = resolve(process.cwd(), 'designs');
  mkdirSync(designsDir, { recursive: true });
  const contractsDir = resolve(process.cwd(), 'contracts');
  mkdirSync(contractsDir, { recursive: true });

  return {
    name: 'novakai-file-bridge',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        (async () => {
          if (!req.url) return next();
          const url = new URL(req.url, 'http://localhost');

          if (url.pathname === '/novakai/designs' && req.method === 'GET') {
            if (!isLoopback(req)) { res.statusCode = 403; return res.end(); }
            const names = readdirSync(designsDir)
              .filter((f) => f.endsWith('.design.mmd'))
              .map((f) => f.slice(0, -'.design.mmd'.length))
              .sort();
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ names }));
          }

          if (url.pathname === '/novakai/designs/read' && req.method === 'GET') {
            if (!isLoopback(req)) { res.statusCode = 403; return res.end(); }
            const name = url.searchParams.get('name') || '';
            const path = designPath(designsDir, name);
            if (path === null) { res.statusCode = 400; return res.end(); }
            if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
            res.setHeader('Content-Type', 'text/plain');
            return res.end(readFileSync(path, 'utf8'));
          }

          if (url.pathname === '/novakai/designs/write' && req.method === 'POST') {
            if (!isLoopback(req)) { res.statusCode = 403; return res.end(); }
            const raw = await readBody(req);
            let body;
            try {
              body = JSON.parse(raw);
            } catch {
              res.statusCode = 400;
              return res.end();
            }
            const name = body && body.name;
            const text = body && body.text;
            if (typeof text !== 'string') { res.statusCode = 400; return res.end(); }
            const path = designPath(designsDir, name);
            if (path === null) { res.statusCode = 400; return res.end(); }
            writeFileSync(path, text);
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ ok: true }));
          }

          if (url.pathname === '/novakai/contracts' && req.method === 'GET') {
            if (!isLoopback(req)) { res.statusCode = 403; return res.end(); }
            const contracts = listContracts(contractsDir);
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ v: 1, contracts }));
          }

          if (url.pathname === '/novakai/contracts/write' && req.method === 'POST') {
            if (!isLoopback(req)) { res.statusCode = 403; return res.end(); }
            const raw = await readBody(req);
            let body;
            try {
              body = JSON.parse(raw);
            } catch {
              res.statusCode = 400;
              return res.end();
            }
            const record = body && body.record;
            const error = validateContractRecord(record);
            if (error !== null) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ error }));
            }
            const path = contractPath(contractsDir, record.id);
            if (path === null) { res.statusCode = 400; return res.end(); }
            writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ ok: true }));
          }

          next();
        })().catch(() => {
          res.statusCode = 500;
          res.end();
        });
      });
    },
  };
}
