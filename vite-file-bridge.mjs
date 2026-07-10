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

const DESIGN_EXT = '.design.mmd';

// containment: resolve then verify the resolved path stays INSIDE designsDir.
// checked against designsDir + sep, never a bare startsWith(designsDir) —
// that admits a sibling `designs-evil`.
export function designPath(designsDir, name) {
  const clean = safeName(name);
  if (clean === null) return null;
  const abs = resolve(designsDir, clean + DESIGN_EXT); // extension appended SERVER-side, never trusted from client
  return abs.startsWith(resolve(designsDir) + sep) ? abs : null;
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
  const abs = resolve(contractsDir, id + '.contract.json');
  return abs.startsWith(resolve(contractsDir) + sep) ? abs : null;
}

// ---------------------------------------------------------------------
// I/O helpers.
// ---------------------------------------------------------------------

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function deny(res, code) {
  res.statusCode = code;
  res.end();
}

function sendJson(res, text, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(text);
}

function readBody(req) {
  return new Promise((done, fail) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => done(data));
    req.on('error', fail);
  });
}

async function readJsonBody(req) {
  try {
    return JSON.parse(await readBody(req));
  } catch {
    return null;
  }
}

// a file that fails to parse or isn't a JSON object is SKIPPED — the list
// endpoint never 500s for one bad contract file.
function listContracts(contractsDir) {
  const files = readdirSync(contractsDir).filter((file) => file.endsWith('.contract.json'));
  const records = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(contractsDir, file), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed);
    } catch {
      // skip: unparsable or malformed contract file
    }
  }
  records.sort((recA, recB) => (recA.id < recB.id ? -1 : recA.id > recB.id ? 1 : 0));
  return records;
}

// ---------------------------------------------------------------------
// Endpoint handlers — one per route, uniform (req, res, url, dirs) shape.
// Quoted keys below are wire-format fields the app reads verbatim.
// ---------------------------------------------------------------------

function listDesigns(req, res, url, dirs) {
  const names = readdirSync(dirs.designs)
    .filter((file) => file.endsWith(DESIGN_EXT))
    .map((file) => file.slice(0, -DESIGN_EXT.length))
    .sort();
  sendJson(res, JSON.stringify({ names }));
}

function readDesign(req, res, url, dirs) {
  const path = designPath(dirs.designs, url.searchParams.get('name') || '');
  if (path === null) return deny(res, 400);
  if (!existsSync(path)) return deny(res, 404);
  res.setHeader('Content-Type', 'text/plain');
  res.end(readFileSync(path, 'utf8'));
}

async function writeDesign(req, res, url, dirs) {
  const body = await readJsonBody(req);
  const text = body && body.text;
  if (typeof text !== 'string') return deny(res, 400);
  const path = designPath(dirs.designs, body && body.name);
  if (path === null) return deny(res, 400);
  writeFileSync(path, text);
  sendJson(res, JSON.stringify({ 'ok': true }));
}

function getContracts(req, res, url, dirs) {
  sendJson(res, JSON.stringify({ 'v': 1, contracts: listContracts(dirs.contracts) }));
}

async function writeContract(req, res, url, dirs) {
  const body = await readJsonBody(req);
  const record = body && body.record;
  const error = validateContractRecord(record);
  if (error !== null) return sendJson(res, JSON.stringify({ error }), 400);
  const path = contractPath(dirs.contracts, record.id);
  if (path === null) return deny(res, 400);
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
  sendJson(res, JSON.stringify({ 'ok': true }));
}

const ROUTES = [
  { path: '/novakai/designs', method: 'GET', handle: listDesigns },
  { path: '/novakai/designs/read', method: 'GET', handle: readDesign },
  { path: '/novakai/designs/write', method: 'POST', handle: writeDesign },
  { path: '/novakai/contracts', method: 'GET', handle: getContracts },
  { path: '/novakai/contracts/write', method: 'POST', handle: writeContract },
];

async function handleRequest(req, res, next, dirs) {
  if (!req.url) return next();
  const url = new URL(req.url, 'http://localhost');
  const route = ROUTES.find((entry) => entry.path === url.pathname && entry.method === req.method);
  if (!route) return next();
  if (!isLoopback(req)) return deny(res, 403); // every /novakai endpoint is loopback-only
  return route.handle(req, res, url, dirs);
}

// ---------------------------------------------------------------------
// The plugin.
// ---------------------------------------------------------------------

export default function novakaiFileBridge() {
  const dirs = {
    designs: resolve(process.cwd(), 'designs'),
    contracts: resolve(process.cwd(), 'contracts'),
  };
  mkdirSync(dirs.designs, { recursive: true });
  mkdirSync(dirs.contracts, { recursive: true });

  return {
    name: 'novakai-file-bridge',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handleRequest(req, res, next, dirs).catch(() => deny(res, 500));
      });
    },
  };
}
