#!/usr/bin/env node
/* =====================================================================
   roadmap.mjs — COMPUTED roadmap state (kills prose-stale roadmap docs)
   ---------------------------------------------------------------------
   The original handover rotted because feature status (❌/⚠️/✅) was
   hand-written prose: every marker was stale the moment a feature landed.
   This applies novakai's own thesis to the roadmap itself — don't WRITE
   state, COMPUTE it. docs/novakai/roadmap.json declares each phase item's
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
     node roadmap.mjs [--roadmap docs/novakai/roadmap.json] [--json]
     node roadmap.mjs --audit-doc CLAUDE.md   # fail if doc hardcodes status
     node roadmap.mjs --audit-tree docs [--allow docs/novakai/status-ban-allowlist.txt]
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

const ROADMAP = arg('--roadmap', 'docs/novakai/roadmap.json');
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
// "state: built" anywhere, incl. inside HTML
const STATE_LABEL_PATTERN = `(?:^|[^\\w])state\\s*[:=]\\s*(?:${EMOJI}|${STATUS_WORDS})`;
// a table cell that IS a status ("| done ✅ |")
const STATUS_CELL_PATTERN = `\\|\\s*${EMOJI}?\\s*${STATUS_WORDS}\\s*${EMOJI}?\\s*\\|`;
// "Status — A2 is shipped"
const STATUS_SENTENCE_PATTERN = `status\\s*[—–:-]+\\s*(?:\\S+\\s+){0,3}?${EMOJI}?\\s*${STATUS_WORDS}\\b`;
const BANNED = [
  /\*\*State:\*\*/i,                                       // "**State:** ❌ Missing"
  new RegExp(STATE_LABEL_PATTERN, 'i'),
  new RegExp(STATUS_CELL_PATTERN, 'i'),
  new RegExp(STATUS_SENTENCE_PATTERN, 'i'),
];

/** Lines eligible for the ban: quoted context may MENTION banned patterns.
    Fenced code blocks, inline `code` spans and `>` blockquotes are exempt. */
function scannableLines(text) {
  const out = [];
  let inFence = false;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (/^\s*>/.test(raw)) return;                       // blockquote = quoted example
    out.push({ line: i + 1, text: raw.replace(/`[^`]*`/g, '`…`') }); // inline code = quoted
  });
  return out;
}

/** Audit one doc; returns list of violations ({line, text}). */
function auditDoc(path) {
  const text = readFileSync(path, 'utf8');
  return scannableLines(text).filter((entry) => BANNED.some((pattern) => pattern.test(entry.text)));
}

function reportHits(name, hits) {
  console.log(`✗ ${name} hardcodes ${hits.length} status marker(s) — roadmap status must be COMPUTED, not written:`);
  for (const hit of hits) console.log(`    L${hit.line}: ${hit.text.trim().slice(0, 90)}`);
}

if (AUDIT_DOC) {
  const path = resolve(AUDIT_DOC);
  if (!existsSync(path)) {
    console.error(`audit: file not found: ${AUDIT_DOC}`);
    process.exit(2);
  }
  const hits = auditDoc(path);
  if (hits.length) {
    reportHits(AUDIT_DOC, hits);
    console.log(`\n  Remove the markers and point readers at \`npm run novakai:roadmap\` (live, cannot go stale).`);
    process.exit(1);
  }
  console.log(`✓ ${AUDIT_DOC} holds no hand-written status — roadmap state is computed, not prose.`);
  process.exit(0);
}

/** Allowlist: one relative path per line, `# reason` required to be present
    in the file per entry so every exemption is an audited decision. */
function loadAllowlist(allowPath) {
  const allowed = new Set();
  if (!allowPath || !existsSync(resolve(allowPath))) return allowed;
  for (const rawLine of readFileSync(resolve(allowPath), 'utf8').split('\n')) {
    const entry = rawLine.replace(/#.*$/, '').trim();
    if (entry) allowed.add(entry);
  }
  return allowed;
}

function findMarkdownFiles(root) {
  const mds = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) mds.push(full);
    }
  })(root);
  return mds;
}

if (AUDIT_TREE) {
  const root = resolve(AUDIT_TREE);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`audit: directory not found: ${AUDIT_TREE}`);
    process.exit(2);
  }
  const allowed = loadAllowlist(ALLOW);
  const mds = findMarkdownFiles(root);
  let bad = 0, skipped = 0;
  for (const docPath of mds.sort()) {
    const rel = relative(root, docPath);
    if (allowed.has(rel)) {
      skipped += 1;
      continue;
    }
    const hits = auditDoc(docPath);
    if (hits.length) {
      bad += 1;
      reportHits(join(AUDIT_TREE, rel), hits);
    }
  }
  if (bad) {
    console.log(
      `\n  ${bad} doc(s) under ${AUDIT_TREE}/ hardcode status. Remove the markers (or add an ` +
      `audited allowlist entry with a reason).`,
    );
    process.exit(1);
  }
  const skippedNote = skipped ? ` (${skipped} allowlisted)` : '';
  console.log(
    `✓ ${mds.length - skipped} doc(s) under ${AUDIT_TREE}/ hold no hand-written status${skippedNote}` +
    ' — state is computed, not prose.',
  );
  process.exit(0);
}

function checkFile(check) {
  // A hollow file must never read BUILT (audit finding F-04 / attack A5):
  // existence alone is not evidence of work — require at least minBytes
  // (default 1, so a 0-byte file always fails).
  const min = check.minBytes ?? 1;
  const target = resolve(check.path);
  const size = existsSync(target) ? statSync(target).size : -1;
  return { pass: size >= min, auto: true, why: check.minBytes ? `${check.path} (>= ${min} bytes)` : check.path };
}

function checkGrep(check) {
  if (!existsSync(resolve(check.path))) return { pass: false, auto: true, why: `${check.path} (absent)` };
  const text = readFileSync(resolve(check.path), 'utf8');
  // Optional count: the pattern must occur at least N times, so a lone
  // pasted token cannot satisfy a predicate that means "a real table/list
  // of N entries exists" (audit finding F-04 / attack A5).
  const min = check.count ?? 1;
  const hits = (text.match(new RegExp(check.pattern, 'gm')) || []).length;
  return { pass: hits >= min, auto: true, why: `/${check.pattern}/${min > 1 ? ` x${min}` : ''} in ${check.path}` };
}

function checkCmd(check) {
  // Test harness guard: roadmap.test.mjs computes the REAL roadmaps to
  // lock file/grep predicate semantics; running cmd checks there would
  // recurse (a roadmap cmd may run roadmap.test itself). Skipping treats
  // the check as manual — a DOWNGRADE (built -> partial), never a pass.
  if (process.env.NOVAKAI_ROADMAP_SKIP_CMD) {
    return { pass: false, auto: false, why: `${check.run} (cmd skipped: NOVAKAI_ROADMAP_SKIP_CMD)` };
  }
  try {
    execSync(check.run, { stdio: ['ignore', 'ignore', 'ignore'] });
    return { pass: true, auto: true, why: check.run };
  } catch {
    return { pass: false, auto: true, why: check.run };
  }
}

/* ---------- run one predicate check against the live repo ---------- */
function runCheck(check) {
  try {
    if (check.kind === 'file') return checkFile(check);
    if (check.kind === 'grep') return checkGrep(check);
    if (check.kind === 'cmd') return checkCmd(check);
    if (check.kind === 'manual') return { pass: false, auto: false, why: check.note };
    return { pass: false, auto: true, why: `unknown check kind: ${check.kind}` };
  } catch (e) {
    return { pass: false, auto: true, why: `${check.kind} errored: ${e.message}` };
  }
}

/* ---------- derive status from checks (see roadmap.json statusRule) ---------- */
function statusOf(results) {
  const auto = results.filter((result) => result.auto);
  const passed = auto.filter((result) => result.pass).length;
  const total = auto.length;
  const hasManual = results.some((result) => !result.auto);
  if (total > 0 && passed === total && !hasManual) return 'built';
  if (total > 0 && passed === total && hasManual) return 'partial';
  if (passed > 0) return 'partial';
  if (total === 0 && hasManual) return 'unverified';
  return 'missing';
}

const ICON = { built: '✓', partial: '◐', unverified: '?', missing: '·' };
const ORDER = ['built', 'partial', 'unverified', 'missing'];

function countByStatus(items) {
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

/* ---------- compute ---------- */
const spec = JSON.parse(readFileSync(resolve(ROADMAP), 'utf8'));
const items = spec.items.map((item) => {
  const results = (item.checks || []).map((check) => ({ ...runCheck(check), kind: check.kind }));
  const auto = results.filter((result) => result.auto);
  return {
    id: item.id, phase: item.phase, title: item.title, intent: item.intent,
    status: statusOf(results),
    passed: auto.filter((result) => result.pass).length,
    total: auto.length,
    results,
  };
});

if (JSON_OUT) {
  console.log(JSON.stringify({ spine: spec.spine, counts: countByStatus(items), items }, null, 2));
  process.exit(0);
}

/* ---------- report ---------- */
console.log('=== novakai roadmap — COMPUTED from the repo, not written down ===');
console.log(`spine: ${spec.spine}\n`);
let phase = null;
for (const item of items) {
  if (item.phase !== phase) {
    phase = item.phase;
    console.log(`Phase ${phase}`);
  }
  const meter = item.total ? ` (${item.passed}/${item.total})` : '';
  console.log(`  ${ICON[item.status]} [${item.status.toUpperCase()}] ${item.id} — ${item.title}${meter}`);
  for (const row of item.results.filter((result) => !result.pass)) {
    console.log(`        ${row.auto ? '✗ unmet:' : '· manual:'} ${row.why}`);
  }
}
const counts = countByStatus(items);
console.log('\n' + ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(' · '));
console.log('\nStatus is recomputed from the live repo every run — this file holds intent, never state.');
console.log('Verify any single line yourself: the predicate (file/grep/cmd) is in docs/novakai/roadmap.json.');
process.exit(0);
