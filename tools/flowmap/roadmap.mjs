#!/usr/bin/env node
/* =====================================================================
   roadmap.mjs — COMPUTED roadmap state (kills prose-stale roadmap docs)
   ---------------------------------------------------------------------
   The original handover rotted because feature status (❌/⚠️/✅) was
   hand-written prose: every marker was stale the moment a feature landed.
   This applies flowmap's own thesis to the roadmap itself — don't WRITE
   state, COMPUTE it. docs/flowmap/roadmap.json declares each phase item's
   INTENT (durable) and a PREDICATE (machine checks: file exists / pattern
   present / command exits 0 / declared-manual). This command runs the
   predicates against the live repo and prints built/partial/unverified/
   missing — recomputed every run, so it cannot lie.

   It also enforces the no-prose-state rule: `--audit-doc <file>` fails if a
   markdown doc reintroduces hand-written status markers, so CLAUDE.md can
   never silently drift again. `--audit-tree <dir>` scans every .md under a
   directory (AUD5/F-05: the ban covers docs/**, not one file), with an
   `--allow <file>` allowlist of audited exemptions. Quoted context is exempt:
   fenced code blocks, inline `code` spans and `>` blockquotes may MENTION a
   banned pattern without violating the ban (a doc describing the linter is
   not a status claim).

   Usage:
     node roadmap.mjs [--roadmap docs/flowmap/roadmap.json] [--json]
     node roadmap.mjs --audit-doc CLAUDE.md   # fail if doc hardcodes status
     node roadmap.mjs --audit-tree docs [--allow docs/flowmap/status-ban-allowlist.txt]
   Exit: 0 = computed/audited clean. 1 = audit found banned prose-state.
         2 = bad invocation. (Status itself is informational, never fails —
         pending work is expected, not an error.)
   ===================================================================== */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { execSync } from 'node:child_process';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROADMAP = arg('--roadmap', 'docs/flowmap/roadmap.json');
const JSON_OUT = process.argv.includes('--json');
const AUDIT_DOC = arg('--audit-doc');
const AUDIT_TREE = arg('--audit-tree');
const ALLOW = arg('--allow');

/* ---------- doc audit: no hand-written status may live in prose ---------- */
// The whole point is that status is COMPUTED. A markdown doc that hardcodes a
// per-feature status marker has reintroduced the drift bug, so we fail loud.
// AUD5/F-05 (attack A6): the ban must catch status PHRASING, not two literal
// regexes — and must not flag a doc that merely QUOTES a banned pattern.
const STATUS_WORDS = '(?:missing|partial|done|built|shipped|complete|implemented)';
const EMOJI = '(?:❌|⚠️|✅|✔️|✔)';
const BANNED = [
  /\*\*State:\*\*/i,                                       // "**State:** ❌ Missing"
  new RegExp(`(?:^|[^\\w])state\\s*[:=]\\s*(?:${EMOJI}|${STATUS_WORDS})`, 'i'), // "state: built" anywhere, incl. inside HTML
  new RegExp(`\\|\\s*${EMOJI}?\\s*${STATUS_WORDS}\\s*${EMOJI}?\\s*\\|`, 'i'),   // a table cell that IS a status ("| done ✅ |")
  new RegExp(`status\\s*[—–:-]+\\s*(?:\\S+\\s+){0,3}?${EMOJI}?\\s*${STATUS_WORDS}\\b`, 'i'), // "Status — A2 is shipped"
];

/** Lines eligible for the ban: quoted context may MENTION banned patterns.
    Fenced code blocks, inline `code` spans and `>` blockquotes are exempt. */
function scannableLines(text) {
  const out = [];
  let inFence = false;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; return; }
    if (inFence) return;
    if (/^\s*>/.test(raw)) return;                       // blockquote = quoted example
    out.push({ line: i + 1, text: raw.replace(/`[^`]*`/g, '`…`') }); // inline code = quoted
  });
  return out;
}

/** Audit one doc; returns list of violations ({line, text}). */
function auditDoc(path) {
  const text = readFileSync(path, 'utf8');
  return scannableLines(text).filter((l) => BANNED.some((re) => re.test(l.text)));
}

function reportHits(name, hits) {
  console.log(`✗ ${name} hardcodes ${hits.length} status marker(s) — roadmap status must be COMPUTED, not written:`);
  for (const h of hits) console.log(`    L${h.line}: ${h.text.trim().slice(0, 90)}`);
}

if (AUDIT_DOC) {
  const path = resolve(AUDIT_DOC);
  if (!existsSync(path)) { console.error(`audit: file not found: ${AUDIT_DOC}`); process.exit(2); }
  const hits = auditDoc(path);
  if (hits.length) {
    reportHits(AUDIT_DOC, hits);
    console.log(`\n  Remove the markers and point readers at \`npm run flowmap:roadmap\` (live, cannot go stale).`);
    process.exit(1);
  }
  console.log(`✓ ${AUDIT_DOC} holds no hand-written status — roadmap state is computed, not prose.`);
  process.exit(0);
}

if (AUDIT_TREE) {
  const root = resolve(AUDIT_TREE);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`audit: directory not found: ${AUDIT_TREE}`); process.exit(2);
  }
  // Allowlist: one relative path per line, `# reason` required to be present
  // in the file per entry so every exemption is an audited decision.
  const allowed = new Set();
  if (ALLOW && existsSync(resolve(ALLOW))) {
    for (const ln of readFileSync(resolve(ALLOW), 'utf8').split('\n')) {
      const entry = ln.replace(/#.*$/, '').trim();
      if (entry) allowed.add(entry);
    }
  }
  const mds = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) mds.push(p);
    }
  })(root);
  let bad = 0, skipped = 0;
  for (const p of mds.sort()) {
    const rel = relative(root, p);
    if (allowed.has(rel)) { skipped += 1; continue; }
    const hits = auditDoc(p);
    if (hits.length) { bad += 1; reportHits(join(AUDIT_TREE, rel), hits); }
  }
  if (bad) {
    console.log(`\n  ${bad} doc(s) under ${AUDIT_TREE}/ hardcode status. Remove the markers (or add an audited allowlist entry with a reason).`);
    process.exit(1);
  }
  console.log(`✓ ${mds.length - skipped} doc(s) under ${AUDIT_TREE}/ hold no hand-written status${skipped ? ` (${skipped} allowlisted)` : ''} — state is computed, not prose.`);
  process.exit(0);
}

/* ---------- run one predicate check against the live repo ---------- */
function runCheck(c) {
  try {
    if (c.kind === 'file') {
      // A hollow file must never read BUILT (audit finding F-04 / attack A5):
      // existence alone is not evidence of work — require at least minBytes
      // (default 1, so a 0-byte file always fails).
      const min = c.minBytes ?? 1;
      const p = resolve(c.path);
      const size = existsSync(p) ? statSync(p).size : -1;
      return { pass: size >= min, auto: true, why: c.minBytes ? `${c.path} (>= ${min} bytes)` : c.path };
    }
    if (c.kind === 'grep') {
      if (!existsSync(resolve(c.path))) return { pass: false, auto: true, why: `${c.path} (absent)` };
      const text = readFileSync(resolve(c.path), 'utf8');
      // Optional count: the pattern must occur at least N times, so a lone
      // pasted token cannot satisfy a predicate that means "a real table/list
      // of N entries exists" (audit finding F-04 / attack A5).
      const min = c.count ?? 1;
      const hits = (text.match(new RegExp(c.pattern, 'gm')) || []).length;
      return { pass: hits >= min, auto: true, why: `/${c.pattern}/${min > 1 ? ` x${min}` : ''} in ${c.path}` };
    }
    if (c.kind === 'cmd') {
      // Test harness guard: roadmap.test.mjs computes the REAL roadmaps to
      // lock file/grep predicate semantics; running cmd checks there would
      // recurse (a roadmap cmd may run roadmap.test itself). Skipping treats
      // the check as manual — a DOWNGRADE (built -> partial), never a pass.
      if (process.env.FLOWMAP_ROADMAP_SKIP_CMD) {
        return { pass: false, auto: false, why: `${c.run} (cmd skipped: FLOWMAP_ROADMAP_SKIP_CMD)` };
      }
      try { execSync(c.run, { stdio: ['ignore', 'ignore', 'ignore'] }); return { pass: true, auto: true, why: c.run }; }
      catch { return { pass: false, auto: true, why: c.run }; }
    }
    if (c.kind === 'manual') return { pass: false, auto: false, why: c.note };
    return { pass: false, auto: true, why: `unknown check kind: ${c.kind}` };
  } catch (e) {
    return { pass: false, auto: true, why: `${c.kind} errored: ${e.message}` };
  }
}

/* ---------- derive status from checks (see roadmap.json statusRule) ---------- */
function statusOf(results) {
  const auto = results.filter((r) => r.auto);
  const passed = auto.filter((r) => r.pass).length;
  const total = auto.length;
  const hasManual = results.some((r) => !r.auto);
  if (total > 0 && passed === total && !hasManual) return 'built';
  if (total > 0 && passed === total && hasManual) return 'partial';
  if (passed > 0) return 'partial';
  if (total === 0 && hasManual) return 'unverified';
  return 'missing';
}

const ICON = { built: '✓', partial: '◐', unverified: '?', missing: '·' };
const ORDER = ['built', 'partial', 'unverified', 'missing'];

/* ---------- compute ---------- */
const spec = JSON.parse(readFileSync(resolve(ROADMAP), 'utf8'));
const items = spec.items.map((it) => {
  const results = (it.checks || []).map((c) => ({ ...runCheck(c), kind: c.kind }));
  const auto = results.filter((r) => r.auto);
  return {
    id: it.id, phase: it.phase, title: it.title, intent: it.intent,
    status: statusOf(results),
    passed: auto.filter((r) => r.pass).length,
    total: auto.length,
    results,
  };
});

if (JSON_OUT) {
  const counts = items.reduce((a, it) => ((a[it.status] = (a[it.status] || 0) + 1), a), {});
  console.log(JSON.stringify({ spine: spec.spine, counts, items }, null, 2));
  process.exit(0);
}

/* ---------- report ---------- */
console.log('=== flowmap roadmap — COMPUTED from the repo, not written down ===');
console.log(`spine: ${spec.spine}\n`);
let phase = null;
for (const it of items) {
  if (it.phase !== phase) { phase = it.phase; console.log(`Phase ${phase}`); }
  const meter = it.total ? ` (${it.passed}/${it.total})` : '';
  console.log(`  ${ICON[it.status]} [${it.status.toUpperCase()}] ${it.id} — ${it.title}${meter}`);
  for (const r of it.results.filter((r) => !r.pass)) {
    console.log(`        ${r.auto ? '✗ unmet:' : '· manual:'} ${r.why}`);
  }
}
const counts = items.reduce((a, it) => ((a[it.status] = (a[it.status] || 0) + 1), a), {});
console.log('\n' + ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(' · '));
console.log('\nStatus is recomputed from the live repo every run — this file holds intent, never state.');
console.log('Verify any single line yourself: the predicate (file/grep/cmd) is in docs/flowmap/roadmap.json.');
process.exit(0);
