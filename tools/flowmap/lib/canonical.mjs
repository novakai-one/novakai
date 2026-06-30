/* =====================================================================
   canonical.mjs — the ONE determinism primitive shared by every
   subagent-contract tool (contract.mjs, verify-change.mjs, replay.mjs).
   ---------------------------------------------------------------------
   "100 subagents -> 100 identical results" is only true if every tool
   serialises the same data to the same bytes. That guarantee must have a
   single source of truth, not a per-tool JSON.stringify (none of which
   sort keys — see recon: tools/buildspec/mmd-parse.mjs toMmd is the only
   sorted serialiser, and it is .mmd-only). This module is that source.

     canonicalize(v)   — recursively sort object keys; arrays keep order
                         (array order is data: acceptance-case order, deps).
     canonicalJSON(v)  — canonicalize then JSON.stringify -> byte-stable.
     sha256hex(s)      — hex digest of a string.
     hashOf(v)         — sha256hex(canonicalJSON(v)): the content hash a
                         verdict/packet carries so equality is a hash compare.

   Determinism rules these tools MUST follow (enforced by replay.mjs):
     - no Date.now / new Date / Math.random / performance.now in output
     - no absolute paths in output (repo-relative only)
     - all object output goes through canonicalJSON
   ===================================================================== */

import { createHash } from 'node:crypto';

/** Recursively sort object keys. Arrays preserve order (order is meaningful). */
export function canonicalize(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
  return out;
}

/** Byte-stable JSON: same data -> same string, on any machine, any run. */
export function canonicalJSON(v) {
  return JSON.stringify(canonicalize(v));
}

/** Hex sha256 of a string. */
export function sha256hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Content hash of a value: hashOf(x) === hashOf(y) iff x and y are the same data. */
export function hashOf(v) {
  return sha256hex(canonicalJSON(v));
}
