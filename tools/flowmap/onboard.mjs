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

   Exit: 0 = map trustworthy, ready to onboard. 1 = map NOT trustworthy
   (someone must run `npm run flowmap:ship` first — do not trust the map).
   ===================================================================== */

import { execSync } from 'node:child_process';

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
const quizState = run('node tools/flowmap/quiz.mjs verify');
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

line('Onboarding ready. The map is trustworthy; prove your read with STEP 4 before making design claims.');
process.exit(0);
