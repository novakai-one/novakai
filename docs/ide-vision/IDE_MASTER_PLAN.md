# novakai IDE — master plan (Phase K)

The plan for growing novakai from "canvas editor + tooling" into the full 8-tab IDE.
Everything a 0-context agent needs is in THIS repo; the out-of-repo sandbox is history, not
a dependency. Status of every K item is COMPUTED (`npm run novakai:ide`), never written here.

## 0. Read order for a fresh agent

1. `npm run novakai:onboard` (repo root) — prove the map, get the invariants, take the quiz.
2. `260707_IDE_VISION_RECORD.md` (this folder) — the 8-tab vision + Chris's rulings.
3. `PROTO_MANIFEST.md` (this folder) — the prototype classified into BINDING / ILLUSTRATIVE /
   FAKE, grep-anchored to `novakai_vision_prototype.html` beside it. Never read the HTML whole.
4. `260707_KEY_DECISIONS.md` (this folder) — settled design law. Do not re-litigate.
5. This file — the phases and what each one delivers.

## 1. The shape of the build

The app grows a **shell**: an icon rail + router + page host (the prototype demonstrates the
grammar; ~200 lines there). The current app becomes the **Codebase** page. Every other tab is a
new module following the house architecture — `initX(ctx, deps)` factory, wired in `main.ts`,
cross-module calls through `ctx.hooks`, `ctx.state` the source of truth. Tabs that are not yet
functional render as designed empty states that carry their command (manifest §2, empty-state
row) — law-compliant, honest, no dead pages.

Two non-negotiables inherited from the vision record:
- **R9 — /novakai fundamentals are king.** The prototype is direction; where it clashes with
  the app's architecture or the manifest marks it FAKE, the repo wins.
- **R3 — nomenclature bridge.** Prototype "Builds" = the **Contracts** tab. The existing G/H
  contract tooling (`novakai:contract`, `verify-change`, plans, acceptance) is the data source;
  the tab renders those real artifacts. No simulated data ships, ever (manifest §4).

## 2. Phases (roadmap items K1–K11; predicates in `docs/novakai/ide-roadmap.json`, computed by `npm run novakai:ide`)

Build order = the order below. K3 blocks everything after it; K4 is the keystone slice and the
priority after the shell. Predicates for K3+ are deliberately coarse (module file + `main.ts`
wiring + spec file); each phase's spec hardens its own predicates in the same PR that builds it
— editing `checks` is an explicit act (`ide-roadmap.json` header rule).

- **K1 — Vision import.** The binding artifact chain + this plan live in-repo; the handoff
  points here. (This is the phase the import PR itself delivers.)
- **K2 — Probes.** Three throwaway experiments answering the facts the plans rest on, recorded
  in `docs/ide-vision/PROBES.md` with a PASS/FAIL verdict + reproduction note each:
  (a) **terminal** — Vite dev-server plugin hosting a node-pty ↔ WebSocket bridge, xterm.js in
  the page, real Claude Code running in it (vision ruling R2: no separate backend);
  (b) **files** — File System Access API from the app origin: open a directory, read, edit,
  create a file on disk;
  (c) **contracts render** — one real `.novakai/` / plan artifact rendered into the prototype's
  build-document layout (proves the data → document mapping with zero fake data).
  Probe code is throwaway and does not merge; only `PROBES.md` does. A FAIL sends the affected
  tab's plan back to Chris with the fallback options (vision record D3).
- **K3 — Shell.** Rail + router + page host in `src/`; the existing editor mounts as the
  Codebase page with zero behavioural change (J1 net must stay green — that is the acceptance);
  the other 7 tabs render designed empty states. New module(s) + `main.ts` wiring only.
- **K4 — Contracts tab.** The keystone. Renders the real contract/plan/verdict artifacts as the
  certificate document (manifest §2 rows: trust seal, keystone rule, tide rail, decision-first,
  slice-not-overlay, plain-language-first). Starts read-only over existing artifacts; the
  approve/deploy acts wire to the real gate flow in a later slice of the same phase.
- **K5 — Design tab.** Port of the prototype's Prototypes flows (outcome input → one question →
  live draft with toggles → confirm → hand off to a Contract). The witnessed outcome becomes
  part of the contract (KEY_DECISIONS §1.2).
- **K6 — Agents tab.** xterm.js terminal over the K2(a) bridge; Claude Code is the only agent
  in scope. Needs a design round first (KEY_DECISIONS §2.1 fan-out) — no prototype design exists.
- **K7 — Files tab.** Open/create/switch repos via the File System Access API (K2(b)); the
  loaded repo scopes every other tab (vision record R4 — per-repo everything).
- **K8 — Home tab.** Chat interface with AI; entry point ("What would you like to know?").
  Scope and wiring decided after K2; needs its own design round.
- **K9 — Rules tab.** The organisational ruleset enforced on each contract, user-customisable;
  renders and edits the rules the contract gates actually consume — never a parallel copy.
- **K10 — Analytics tab.** Agent spend / per-contract / per-project metrics, per-repo only.
  Data source design comes after Agents exist (it measures their runs).
- **K11 — Coding standards (Chris's ruling, 2026-07-07).** Human-readable standards are
  mandatory and machine-enforced: sonar-level rules including cyclomatic complexity, max file
  length, max function length. Every rule is documented in `docs/CODING_STANDARDS.md` with an
  enforcement tier — BLOCK (fails CI) or WARN (reports only) — and the lint config enforces
  exactly what the doc states; the two may never disagree. Sequenced before/alongside K3 so all
  new IDE code arrives under the standards; existing code may enter at WARN and ratchet up.

## 3. What every phase must satisfy (acceptance pattern)

Inherited from `PROTO_MANIFEST.md` §5 + the repo's own gates; per-phase specs add specifics:
1. Real Chromium (the J1 Playwright harness), zero console/page-error bar, journeys driven
   end-to-end, screenshots LOOKED at, idle byte-identical where stillness is claimed.
2. The J1 regression net green — the shell must never break the guarded editor surfaces.
3. The full gate chain green: `npm run novakai:verify:full`.
4. Map re-synced (`npm run novakai:ship`) — new modules appear as nodes; the gate proves it.
5. Independent verification: a 0-context agent re-proves from command output alone
   (CLAUDE.md session protocol #3); builder self-reports are never accepted.
6. Two-actor color law (KEY_DECISIONS §3.2) checked in any UI change — it is the product.

## 4. Method (how the phases get built)

Per CLAUDE.md session protocol + Chris's standing rules: plans are pressure-tested by a
strategic challenger BEFORE a line-approver; unknowns get throwaway probes before plans harden
(that is K2); builders are cheap subagents, verifiers are 0-context; implementation slices ride
the repo's own plan machinery (`plan.json` → cert → gate) wherever the target is `src/`.
Design choices: N independent same-brief variants, judged (KEY_DECISIONS §2.1). Engineering
disagreements: settled by empirical probe, not debate (§2.2).
