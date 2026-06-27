# flowmap-spec-tools

The Flowmap spec toolchain, as one installable, versioned package. Install it in
your TypeScript repo instead of copying scripts around — `npm update` then keeps
the bundler, extractor, gate, validator, and the authoring spec
(`SYNTAX_README.md`) in lockstep, so nothing goes stale.

## Install

```bash
# sibling-repo (local) — flowmap checked out next to your project:
npm install -D file:../flowmap/tools

# or from git (pin a tag/commit):
npm install -D "git+https://github.com/<you>/flowmap.git#<tag>"

# or, if published to a registry:
npm install -D flowmap-spec-tools
```

`ts-morph` comes with it (the extractor needs it).

## CLIs

| Command | What it does |
|---|---|
| `flowmap-bundle --root <root.mmd> --dir <srcDir>` | Merge per-folder `flowmap.mmd` fragments into one laid-out `.mmd` (stdout). `--check` lints only. |
| `flowmap-validate <file.mmd>` | Structural lint of any single `.mmd` (one header, no dup ids, every reference resolves). |
| `flowmap-extract --tsconfig <tsconfig.json> --out <extracted.mmd>` | Walk your TS, emit an extracted `.mmd` **and** `<out>.bodies.json` (real bodies + signatures for the source viewer). |
| `flowmap-gate --spec <spec.mmd> --code <extracted.mmd>` | Diff committed spec vs extracted code; exit 1 on drift. `--unplanned-as-warning` softens new-scope to a warning. |
| `flowmap-stubs ...` | Generate TS stubs (signatures only) from a spec's `fm:meta`. |

Run via `npx` or wire into your `package.json` scripts — see the main Flowmap
README for the recommended `flowmap:bundle` / `flowmap:bodies` / `flowmap:ship`
/ `flowmap:gate` script set.

## The authoring spec

`SYNTAX_README.md` (the `.mmd` format an LLM emits or you hand-author) ships
inside this package, so the spec you read always matches the validator that
enforces it. After install it's at
`node_modules/flowmap-spec-tools/SYNTAX_README.md`.
