#!/usr/bin/env node
/* =====================================================================
   ship-stamp.mjs — records the src/ content hash `flowmap:ship` just
   verified against, so ship-staleness.mjs (the Stop hook) can compare
   CONTENT instead of commit timestamps.
   ---------------------------------------------------------------------
   Why: the old predicate compared `git log -1 -- src/` to `git log -1 --
   -- _bundle.mmd`. On a branch where the regenerated map is byte-identical
   to HEAD (a map-neutral src change — a readability refactor, a CSS-in-TS
   tweak, anything below the map's abstraction level), there is no map
   diff to commit, so "src commit newer than map commit" can never be
   satisfied again — the hook re-blocked every stop (KNOWN_EDGES.md,
   2026-07-04). A content hash of src/ has no such dead end: any src
   change — including a map-neutral one — changes the hash, so the stamp
   always has something to commit, which is exactly what makes the
   predicate satisfiable.

   Runs as the last step of flowmap:ship:steps (package.json). Writes
   docs/flowmap/ship-stamp.json — committed alongside the map/code it
   was generated from.

   Content-only, write-if-different: the stamp holds ONLY srcTree (no
   timestamp — git history already timestamps commits). A wall-clock
   field would change on every run regardless of content, so a no-op
   `flowmap:ship` would always dirty the stamp file and break ship
   idempotency ("git status --porcelain empty after ship"). Skipping the
   write when the content is unchanged keeps repeated ships byte-stable.
   ===================================================================== */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { srcTreeHash } from '../lib/src-tree-hash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..', '..');
const STAMP = join(ROOT, 'docs', 'flowmap', 'ship-stamp.json');

const srcTree = srcTreeHash(ROOT);
const next = JSON.stringify({ srcTree }, null, 2) + '\n';
let prev = null;
try { prev = readFileSync(STAMP, 'utf8'); } catch { /* no stamp yet */ }
if (prev !== next) {
  mkdirSync(dirname(STAMP), { recursive: true });
  writeFileSync(STAMP, next);
}
process.stdout.write(`ship-stamp: recorded src tree ${srcTree}\n`);
