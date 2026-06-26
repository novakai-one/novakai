# AI build workflow — direction & idea backlog

Strategy doc, not a code work order. Captures the agreed direction for using this repo's `.mmd`
as a build contract with Claude, so this can be picked up later without re-reading a long thread.
The LLM-enhanced ideas (section "Edges") are written out in full because they were the unclear part.

## Goal
Make Claude's build plans drift-proof and enforceable, so AI builds with minimal deviation. The
`.mmd` is the build spec / contract. ALL ongoing enforcement is deterministic tooling. The LLM sits
only at the edges — planning and authoring — never in the enforcement loop. That separation is what
keeps the whole thing from rotting.

## The pipeline (agreed set), in build order
Each item, plainly:

1. **Spec → TS stubs + test scaffolds** — the engine. Generate TypeScript from `fm:meta`: every node
   with interfaces emits an `interface` / `abstract class` / function signature with the exact
   accepts/returns, body `throw new Error('unimplemented')`. Claude Code fills bodies, never
   signatures. Interface drift stops being a review finding and becomes a `tsc` error, continuously,
   for free. The same generator emits one contract-test stub per interface (shape assertions). The
   contract literally *is* the types. Deterministic.
2. **Extract from TS (ts-morph)** — ground truth. Walk the AST and re-serialize the actual code back
   into an `.mmd`: nodes, kind, parent (file nesting), import edges, registry membership, hook
   bindings (read from the composition root, `main.ts`). This extracted mmd cannot drift — it *is*
   the code. Deterministic.
3. **Gate: diff extracted vs spec, fail on drift** — diff #2's output against the committed spec on
   every PR. Spec node with no symbol → unbuilt (fail). Symbol with no spec node → unplanned scope
   (fail/warn). Signatures differ → interface drift (fail). 1+2 make this trivial. Deterministic.
4. **Search** — paste an mmd, find a class/module/type. Navigates the extracted graph. Human surface.
5. **In-app diff** — paste two mmds, see the delta visually. Your viewer for the same diff #3 gates
   on. Human surface.

1–3 are the autonomy machine (no LLM to run, ever). 4–5 are the human surface; they likely share one
parser, so build them together.

## What this gates — and what it does NOT
Gated deterministically: nodes, kind, parent, interface signatures, import edges, registry
membership. That's *structure*, and it's covered every which way.

NOT gated: **behavior**. Prose claims like "folds onto proposed" or "never mutates currentReadOnly"
are sentences, not checks. Types verify shape; nothing verifies behavior. This is the one real open
edge. Idea A below closes it.

## Edges — LLM-enhanced ideas (put the LLM where it's strong, never in the loop)

### A. Generate behavioral test BODIES from the fm:meta prose  ← the pick
- **The gap it fills:** `tsc` checks shape; the gate checks structure; behavior is unchecked. If
  Claude Code writes a body that mutates `currentReadOnly`, the build is green, the gate is green,
  and the bug ships — because the only record of "never mutates currentReadOnly" is a comment.
- **What it is:** an LLM reads each node's behavioral prose once and writes the real test body that
  asserts it — e.g. snapshot `currentReadOnly` before and after, assert deep-equal; or assert the
  result folds onto `proposed` and nothing else changes. You review it once.
- **Why the LLM here:** turning an English claim into an assertion is exactly an LLM strength;
  *running* it forever is a test runner's job. The LLM authors once; CI enforces deterministically
  from then on — no LLM in the loop.
- **Net:** converts un-gateable behavior into gateable tests. Closes the only genuine gap.

### B. Intent → spec delta
- **The gap it fills:** authoring/editing the mmd spec is the manual step.
- **What it is:** you describe a change in plain English ("add a cache layer between `store` and
  `storage`"); the LLM proposes the `fm:meta` diff (new nodes, edges, signatures); you approve; the
  deterministic pipeline (1–3) takes over and enforces it.
- **Why the LLM here:** front-loads planning into language and keeps you as approver, not author.
  The LLM proposes, never enforces.
- **Net:** faster re-planning; the spec stays intentional (human-approved), so it doesn't rot.

### C. Advisory PR reviewer (warn, never block)
- **The gap it fills:** some claims can't be a type or even a simple test — architectural intent like
  "siblings, no cross-talk."
- **What it is:** an LLM reads a PR's code against the prose claims that types and tests can't
  capture, and posts comments. Advisory only; it can be wrong, so it never fails the build.
- **Why the LLM here:** catches the residue the deterministic gate structurally cannot, without
  putting a fallible LLM in the blocking path.
- **Net:** a safety net for the un-formalizable, with zero authority.

## Risk / leverage / complexity (honest read)
- **Leverage:** high. Every layer is mechanically checkable and reversible.
- **Risk:** low overall, with ONE watch-point — the ts-morph extractor (#2). Its failure mode is not
  "it crashes," it's "it silently undercounts → the gate reports green on a drifted state → false
  confidence." Test the extractor against a known hand-verified graph before trusting the gate.
- **Complexity:** concentrated in the extractor. #1/#3 are thin; #4/#5 trivial; A–C are bounded
  (one-time authoring, always behind human approval).
- **Portability:** the method (spec → stubs → extract → diff → gate) is general. Only the extractor
  is coupled — to the language (ts-morph = TS only) and to conventions (class→node, file nesting→
  parent, centralized wiring in `main.ts`). It ports cleanly to repos *built* this way; aimed at
  arbitrary legacy code it undercounts. Since you have Claude build new repos from a spec, you
  mandate the legible conventions up front — so it fits.

## The one rule that keeps it honest
Deterministic tooling does ALL ongoing enforcement. The LLM only authors (specs, test bodies) and
advises — always behind human approval, never in the runtime or CI blocking loop. The moment an LLM
is *required* to re-run for enforcement, nondeterminism and drift are back.

## Build order
2 → 1 → 3 (the machine), then 4 / 5 (share the parser), then A (closes the behavior gap), then
B / C as autonomy polish.
