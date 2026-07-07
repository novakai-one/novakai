# novakai IDE — Vision Record (2026-07-07)

Authority: Chris, directly, 2026-07-07 (conversation rulings). This document is the durable
carrier of the 8-tab IDE vision so no agent ever needs the originating conversation.
Read order for any agent working this effort:
1. This file.
2. `PROTO_MANIFEST.md` (this folder) — BINDING/ILLUSTRATIVE/FAKE classification of the working
   prototype `novakai_vision_prototype.html` (beside it; never read the HTML whole; grep anchors).
3. `260707_KEY_DECISIONS.md` (this folder) — settled design/method law. Do not re-litigate.
4. `npm run novakai:onboard` (repo root), then `docs/novakai/_bundle.mmd` — the real app you are
   building into.
5. `IDE_MASTER_PLAN.md` (this folder) — the phases (roadmap items K1–K11) and build order.

## The shift

Novakai grows from "canvas diagram editor + tooling" into a **fully integrated development
environment**. Everything novakai currently IS becomes one tab (**Codebase**). The app gains a
left-nav shell with 8 pages. Nothing existing is deleted; the contract/packet tooling built to
date (phases G/H) is the enforcement substrate under the new Contracts tab.

## The 8 tabs (Chris's definitions, distilled)

| # | Tab | What it is | Maps to |
|---|-----|-----------|---------|
| 1 | **Home** | Chat interface with AI. Entry point ("What would you like to know?"). | New. |
| 2 | **Design** | The proto's "Prototypes" tab — Claude-design-style: create a vision of the outcome; the witnessed outcome becomes part of the contract (KEY_DECISIONS §1.2). | Proto design exists. |
| 3 | **Codebase** | The canvas node view — the existing novakai app, whole. | Built (the current `src/`). |
| 4 | **Contracts** | THE keystone. A work order / job: pulls together all information for a contract and shows what is enforceable and trustable. A list of documents a user reads start to end. Proto calls this "Builds". | Proto design + real G/H tooling (`novakai:contract`, verify-change, plans, acceptance tests). |
| 5 | **Agents** | Terminal-based interface. Claude Code is the only agent in scope. Not designed yet. | New. |
| 6 | **Files** | Work *in* novakai: load files/folders from local drives (VS Code / Obsidian style), switch between repos, create new files that land on the user's disk. | New. |
| 7 | **Analytics** | Performance/cost metrics: spend on agents, cost per project / per contract. | New. |
| 8 | **Rules** | Organisational rules enforced on each contract; user-customisable ruleset. | New. |

## Rulings (2026-07-07 conversation — binding until Chris overrules)

R1. **Canvas is one component of the whole.** The current app becomes the Codebase tab; a
    shell/nav owns the 8 pages. Growth, not replacement.
R2. **No separate backend.** The app stays a localhost app in Chromium. Agents-tab terminal is
    feasible without a deployed backend: the Vite dev server (already a local Node process)
    hosts a PTY bridge (e.g. node-pty + WebSocket via a Vite plugin), xterm.js renders in-page —
    Claude Code operates exactly as in a real terminal. Files uses the Chromium File System
    Access API (pure browser, real disk read/write/create). **Both mechanisms require a cheap
    throwaway probe before the plan hardens around them** (challenger-before-approver rule).
R3. **Nomenclature bridge — nothing is obsolete.** Proto "Builds" = tab "Contracts". The
    existing structural contract/packet work (G/H phases) IS what the new tab surfaces. The new
    vision adds: feature + design (the witnessed Design outcome) + enforceability (patch +
    `.mmd`) in one readable document.
R4. **Per-repo scoping everywhere.** Each repo gets its own analytics / contracts / everything.
    Cross-repo is out of scope for now.
R5. **Plan everything now.** All 8 tabs are planned in this effort; build order is a proposal
    inside the plan, plan order has no dependency. (Chris: no delay; the earlier staging idea
    was priority-based only.)
R6. **Agents tab scope**: Claude Code only. No design exists yet — it needs the design track
    (fan-out per KEY_DECISIONS §2.1), not just engineering.
R7. **Contracts is the core of novakai.** The tab renders a document the user reads start to
    end; everything enforceable and trustable is pulled together there.
R8. **Design source of truth** for ported surfaces is the prototype HTML *through*
    `PROTO_MANIFEST.md` — BINDING rows implemented exactly, ILLUSTRATIVE rows as behavior,
    FAKE rows never ported. The color law (two-actor, §3.2) is the most-protected rule.
R9. **The fundamentals of /novakai are king.** The sandbox prototype is for DIRECTION only —
    it does not carry the engineering effort /novakai was built with. Never import what is
    clearly fake (manifest §4) or what already exists, better-built, in /novakai (edges, map
    pipeline, ctx architecture, gate tooling). Where the proto and /novakai clash, /novakai wins.
R10. **The plan itself must be novakai-grade.** Vision stored cleanly, decisions documented,
    zero loss in agent handover — the same idea novakai is built for. Method: strategic
    challenger BEFORE line-approver; unknowns de-risked by throwaway probes; two consecutive
    clean 0-context audits before execution; independent verification before PR.

## Open decisions for Chris (marked, not assumed)

D1. **Phase-1 functional bar per tab** — which tabs must be *functional* in the first build
    phase vs present-as-designed-empty-state (empty states carry their command, §3.10). The
    master plan (`IDE_MASTER_PLAN.md` §2) proposes a sequence; Chris rules on it.
D2. RESOLVED (Chris, 2026-07-07): everything the implementation needs lives in `/novakai` —
    this folder (`docs/ide-vision/`) is the canonical home; the out-of-repo sandbox is history.
D3. **Agents/Files probe results** — if a probe falsifies R2's mechanism, the fallback (a tiny
    local companion process) comes back to Chris before any plan hardens.

## The plan

`IDE_MASTER_PLAN.md` (this folder): the phases (K1–K11), build order, per-phase acceptance
pattern, and method. Phase status is computed by `npm run novakai:ide` from predicates in
`docs/novakai/ide-roadmap.json` — never written down. Per-tab specs and probe records are authored
into this folder by the phases that produce them (K2 emits `PROBES.md`; each build phase emits
its spec in the PR that builds it). Implementation slices that touch `src/` ride the repo's own
plan machinery (`plan.json` → cert → gate) — novakai plans novakai.
