#!/usr/bin/env node
/* =====================================================================
   onboard.mjs — the single verifiable door for a 0-context agent
   ---------------------------------------------------------------------
   A new Claude should not inherit understanding from prose or from a
   previous agent's summary (both drift, neither is testable). This command
   is the one entry point: it (1) PROVES the map is true + complete as of
   HEAD before the agent trusts a word of it, (2) states the only prose an
   agent must trust — the durable invariants, (3) points at the verified
   artifacts, (4) emits the comprehension quiz so the agent's understanding
   becomes a pass/fail test, and (5) shows any in-flight plan's real state.

   Onboard-cost item 3 (design: docs/flowmap/onboard-cost-design.md) — the
   command gains a CONTINUE track for Scenario-1 sessions whose blast radius
   an in-flight plan already declares: `--continue --plan <plan.json>` keeps
   STEP 1 (map trust) and the invariants, then points at root.mmd + the
   handoff's live entry + ONLY the plan modules' fragments, and emits the
   scoped quiz commands for exactly those modules. The full track (no flag)
   is unchanged and remains the door for whole-app design sessions. The
   continue track always prints the out-of-scope design-question rule; the
   same rule lives in CLAUDE.md's session protocol (F1).

   Exit: 0 = map trustworthy, ready to onboard. 1 = map NOT trustworthy
   (someone must run `npm run flowmap:ship` first — do not trust the map).
   2 = bad invocation (--continue without --plan).
   ===================================================================== */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

const CONTINUE = process.argv.includes('--continue');
function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const PLAN = argOf('--plan');
// Show the quiz state THIS session's gate will actually see (item 4): when the
// harness exposes the session id, the displayed verify is session-bound too —
// otherwise onboard could print VERIFIED off another session's pass while the
// edit gate denies. Without the env (manual run) the display stays hash-only.
const SESSION_ARG = process.env.CLAUDE_CODE_SESSION_ID
  ? ` --session ${process.env.CLAUDE_CODE_SESSION_ID}` : '';
if (CONTINUE && !PLAN) {
  console.error('usage: onboard.mjs --continue --plan <plan.json>   (the continue track is scoped BY the in-flight plan; without one, run the full track)');
  process.exit(2);
}

function run(cmd) {
  try { return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; }
}

const line = (s = '') => console.log(s);

line('=== flowmap onboarding — verifiable handover for a 0-context agent ===\n');

/* ---------- STEP 1: prove the map is trustworthy ---------- */
line('STEP 1 — proving the map is TRUE + COMPLETE as of HEAD (validate · lint · file-coverage · symbol-coverage · gate)...');
const verify = run('npm run --silent flowmap:verify');
if (!verify.ok) {
  line(verify.out.trim());
  line('\n✗ STOP — the map is NOT trustworthy. It is stale or incomplete vs the code.');
  line('  Do not onboard from it. Run `npm run flowmap:ship`, commit, and re-run onboarding.');
  process.exit(1);
}
line('✓ MAP TRUSTWORTHY — every node exists in code, signatures match, no exported symbol is hidden.\n');

/* ---------- STEP 2: the durable invariants (the only trusted prose) ---------- */
line('STEP 2 — the durable invariants (the ONLY prose to trust; everything else is verifiable):');
line('  1. main.ts is the composition root — the only module that imports every other. Each module is');
line('     a factory initX(ctx, deps) => api. To see how anything connects, read main.ts.');
line('  2. Modules NEVER import each other\'s runtime code — they call ctx.hooks.<fn>(). main.ts assigns the');
line('     real implementations onto ctx.hooks after every module is built (breaks import cycles).');
line('  3. ctx (AppContext) is the single shared object passed to every init. ctx.state is the source of');
line('     truth; the Mermaid text and the canvas are views of it. io/mermaid.ts is the only serialiser.');
line('  (Full orientation: CLAUDE.md. These three are durable; the precise map regenerates from code.)\n');

/* ---------- CONTINUE track: scoped onboarding for an in-flight plan ---------- */
if (CONTINUE) {
  let plan;
  try { plan = JSON.parse(readFileSync(resolve(PLAN), 'utf8')); }
  catch { console.error(`cannot read plan: ${PLAN}`); process.exit(2); }
  const ownerOf = (id) => (id.includes('__') ? id.split('__')[0] : id);
  const mods = [...new Set((plan.changes || [])
    .map((c) => c?.target?.ref).filter(Boolean).map(ownerOf))].sort();

  // Colocated fragments (same contract the bundler and quiz --file use).
  const frags = {};
  const srcDir = resolve('src');
  if (existsSync(srcDir)) {
    for (const ent of readdirSync(srcDir, { recursive: true })) {
      const rel = String(ent);
      if (!rel.endsWith('.flowmap.mmd')) continue;
      const m = /^%%\s*root\s+([A-Za-z0-9_]+)\s*$/m.exec(readFileSync(join(srcDir, rel), 'utf8'));
      if (m) frags[m[1]] = 'src/' + rel.split(sep).join('/');
    }
  }
  const scoped = mods.filter((m) => frags[m]);
  const unmapped = mods.filter((m) => !frags[m]);

  line(`CONTINUE TRACK — scoped by ${PLAN} (whole-app design sessions: run the full track, no --continue)\n`);
  line('STEP 3 (scoped) — read these, NOT the whole bundle:');
  line('  • docs/flowmap/root.mmd             module-level topology + shared nodes');
  line('  • docs/flowmap/SESSION_HANDOFF.md   the live 0·now entry + Next (superseded entries are archived)');
  if (scoped.length) {
    line('  • the plan modules\' fragments:');
    for (const m of scoped) line(`      - ${m}  ${frags[m]}`);
  }
  if (unmapped.length) {
    line(`  • plan refs with no src fragment (tooling or to-be-added — read via their own maps/plans): ${unmapped.join(', ')}`);
  }
  line('');
  line('STEP 4 (scoped) — prove your read of exactly that scope:');
  if (scoped.length) {
    const s = scoped.join(',');
    line(`  1) npm run flowmap:quiz -- generate --scope ${s} --n 8 --seed 1`);
    line('  2) Answer from root.mmd + the fragments above; write {"q1":"..."} to answers.json');
    line(`  3) npm run flowmap:quiz -- check --answers answers.json --scope ${s} --n 8 --seed 1`);
    line('  A scoped pass unlocks src/ edits ONLY inside this scope (+ current neighbours).');
  } else {
    line('  (no src modules in this plan — the edit gate does not apply; tooling changes carry their own tests)');
  }
  const contQuiz = run('node tools/flowmap/quiz.mjs verify' + SESSION_ARG);
  line('  Current state: ' + contQuiz.out.trim().replace(/\n/g, '\n  '));
  line('');
  line('STEP 5 — the plan\'s VERIFIED work-state (recomputed from code, not a prose note):');
  line(`  npm run flowmap:status -- --plan ${PLAN}\n`);
  line('RULE — Design questions outside the proven scope require either reading the relevant fragments and re-quizzing that scope, or re-running full onboard.');
  line('');
  const contFresh = run('node tools/flowmap/handoff-fresh.mjs --check');
  if (contFresh.ok) {
    line('✓ HANDOFF FRESH — docs/flowmap/SESSION_HANDOFF.md is at least as fresh as the last code commit.\n');
  } else {
    line('⚠ HANDOFF LAGS THE CODE — derive state from the commands above and treat the handoff as SUSPECT.\n');
  }
  line('Continue-onboarding ready. Prove your scoped read with STEP 4 before touching the plan\'s modules.');
  process.exit(0);
}

/* ---------- STEP 3: the verified artifacts ---------- */
line('STEP 3 — read these (regenerated from code, gate-verified — not prose):');
line('  • docs/flowmap/_bundle.mmd   the architecture map: every unit, its kind, signature, drill parent, edges');
line('  • public/bodies.json         the real source body per node (for the units you need to read)');
line('  • npm run flowmap:trust      which claims are PROVEN (signatures) vs ADVISORY (desc) vs UNVERIFIED (edges)\n');

/* ---------- STEP 4: prove understanding ---------- */
line('STEP 4 — make your understanding TESTABLE (a prose "I understand" is not accepted):');
line('  1) npm run flowmap:quiz -- generate --n 12 --seed 1');
line('  2) Answer each question using ONLY _bundle.mmd; write {"q1":"...","q2":"..."} to answers.json');
line('  3) npm run flowmap:quiz -- check --answers answers.json --seed 1');
line('  100% => UNDERSTANDING VERIFIED, the handover is trusted. Anything less => re-read the map.');
// F-03: the pass is a machine-checked artifact bound to the current map
// bytes — report its live state so an unpassed/stale quiz is visible at
// every session start instead of relying on the agent to remember.
const quizState = run('node tools/flowmap/quiz.mjs verify' + SESSION_ARG);
line('  Current state: ' + quizState.out.trim().replace(/\n/g, '\n  '));
line('');

/* ---------- STEP 5: where work stands ---------- */
line('STEP 5 — if a build plan is in flight, get its VERIFIED state (recomputed from code, not a prose note):');
line('  npm run flowmap:status -- --plan <plan.json>');
line('  built = landed · pending = the build checklist · drifted = code diverged from the approved signature\n');

/* ---------- STEP 6: the roadmap — computed, and CLAUDE.md proven prose-state-free ---------- */
line('STEP 6 — the roadmap is COMPUTED, never prose (so it cannot go stale like the old handover did):');
const audit = run('npm run --silent flowmap:roadmap:audit');
if (!audit.ok) {
  line(audit.out.trim());
  line('\n✗ STOP — CLAUDE.md has reintroduced hand-written status. Roadmap state must be computed.');
  line('  Remove the marker(s) above and re-run onboarding.');
  process.exit(1);
}
line(audit.out.trim());
const road = run('npm run --silent flowmap:roadmap');
if (road.ok) line(road.out.trimEnd().split('\n').slice(2).join('\n')); // skip the banner, show the phases
line('');

/* ---------- STEP 7: handoff freshness — surfaced at session START ----------
   AUD5/F-09 (attack A8): the Stop-hook nudge fires only on a clean Stop, so a
   crashed session never warns anyone the handoff lags the code. Session START
   is crash-proof — whatever killed the last session, the next one onboards.
   This is a NUDGE, not a gate: onboard's exit code stays about map trust;
   F4 in CI (flowmap:handoff:check on flowmap-drift) is the hard backstop. */
line('STEP 7 — is the handoff at least as fresh as the code? (crash-proof surface; F4 CI is the backstop):');
const fresh = run('node tools/flowmap/handoff-fresh.mjs --check');
if (fresh.ok) {
  line('✓ HANDOFF FRESH — docs/flowmap/SESSION_HANDOFF.md is at least as fresh as the last code commit.\n');
} else {
  line('⚠ HANDOFF LAGS THE CODE — the last session ended (or crashed) without re-syncing:');
  line('  ' + fresh.out.trim().split('\n').join('\n  '));
  line('  Before building on this checkout: read the handoff as SUSPECT, derive state from the');
  line('  commands (flowmap:status / flowmap:roadmap), and update the handoff with your session.\n');
}

line('Onboarding ready. The map is trustworthy; prove your read with STEP 4 before making design claims.');
process.exit(0);
