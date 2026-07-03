# Plan — close E4 + F5 by repairing their stale CI-wiring predicates

Scope note (recorded assumption): this plan touches only `docs/flowmap/roadmap.json`
verification predicates and docs. It maps to zero `src/` nodes, so the `plan.json`
machinery (plan-check / cert / acceptance target map node ids) does not apply; this
`.md` plan follows the `unfold-ux-repair.md` precedent.

## The problem, verifiable

E4's and F5's unmet rows grep `.github/workflows/spec-gate.yml` for literal test
filenames (`acceptance.test`, `plan-layout.test`, `loop-e2e.test`). But the repo's own
AUD5/F-06 ruling made CI consume ONE canonical test list instead of enumerating test
files. Verify each fact:

- `grep -n "spec:test:all" .github/workflows/spec-gate.yml` — the buildspec-tests job
  runs the canonical suite on every push/PR (no path filter, per F-07).
- `node -e "const s=require('./package.json').scripts['spec:test:all']; for (const f of ['tools/buildspec/acceptance.test.mjs','tools/buildspec/plan-layout.test.mjs','tools/flowmap/loop-e2e.test.mjs']) console.log(f, s.includes(f))"`
  — all three suites are in the canonical list, so all three already run in CI.
- `node --test tools/flowmap/gate-parity.test.mjs` — the suite that fails the build if
  a CI-only test enumeration ever reappears in spec-gate.yml.

The loop IS enforced in CI; the predicates tested the pre-F-06 mechanism (literal
enumeration in the workflow), not the intent (the suites run on every push/PR).

## Rejected alternative

Adding `node --test tools/...` lines back to spec-gate.yml would satisfy the literal
greps — and would even survive gate-parity's no-CI-only-tests assertion, since the
files are in the suite — but it reintroduces exactly the two-diverging-lists shape
F-06 killed, and runs the three suites twice per CI run. Rejected.

## The change

`docs/flowmap/roadmap.json` only. Each stale single-link grep becomes a fail-closed
two-link chain: (a) spec-gate.yml runs `npm run spec:test:all`, and (b) package.json's
`spec:test:all` contains the specific test file. Breaking either link re-opens the
roadmap item.

- E4: keep the `flowmap:cert` grep; add the canonical-suite grep on spec-gate.yml; pin
  the real-plan acceptance step (`flowmap:acceptance -- --plan public/plan.json`);
  replace the two literal-filename greps with package.json greps for
  `tools/buildspec/acceptance.test.mjs` and `tools/buildspec/plan-layout.test.mjs`.
- F5: keep the file + cmd checks; replace the spec-gate.yml literal grep with the
  canonical-suite grep plus a package.json grep for `tools/flowmap/loop-e2e.test.mjs`.

## Acceptance (run after the edit)

- `npm run flowmap:roadmap` — 32 built, 0 partial (E4 5/5, F5 4/4).
- `node --test tools/flowmap/roadmap.test.mjs tools/flowmap/gate-parity.test.mjs` — pass.
- `npm run flowmap:roadmap:audit` — both scans clean.
- `npm run flowmap:ship` — DONE line; `git status` shows no regenerated drift.
