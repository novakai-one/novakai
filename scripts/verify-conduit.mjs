import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Files that must remain pure conduits (no decisions).
const CONDUITS = [
  "src/components/workspace/WorkspaceArea.tsx",
];

// Patterns that signal a DECISION made inside a conduit. Forbidden.
const FORBIDDEN = [
  /\.dispatch\(/,                 // firing decisions
  /getState\(\)\.\w+\s*\?\?/,     // reading + defaulting state to branch
  /const\s+create\w+At\b/,        // createBlockAt-style decision makers
  /const\s+(delete|place|insert)\w+\b\s*=/,
];

let failed = false;
for (const file of CONDUITS) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  for (const pattern of FORBIDDEN) {
    if (pattern.test(src)) {
      console.error(`CONDUIT VIOLATION in ${file}: ${pattern}`);
      console.error("  -> A container made a decision. Move it into a manager.");
      failed = true;
    }
  }
}

if (failed) {
  console.error("\nverify:conduit FAILED. See CLAUDE.md section 1.1.");
  process.exit(1);
}
console.log("verify:conduit passed.");

// ── WORKER_PAYLOAD (warn phase) ───────────────────────────────────────────────
// Door/Worker law (src/CLAUDE.md): a Worker is a pure builder — it takes Fields,
// never the Payload. A module-scope function that accepts DocShape/DocDraft is a
// Worker holding the whole shape, so it cannot declare its real inputs (rule D3).
// Warn for now — the selection/clipboard managers still violate this; flipping to
// a hard gate happens once they are triaged (same bootstrap as the eslint caps).
const WORKER_PAYLOAD = /^(?:export\s+)?function\s+([A-Za-z0-9_]+)\s*\([^)]*:\s*(DocShape|DocDraft)\b/gm;

function tsFilesUnder(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const warnings = [];
for (const file of tsFilesUnder("src/managers")) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  for (const match of src.matchAll(WORKER_PAYLOAD)) {
    warnings.push(`  ${file}: function ${match[1]}(… : ${match[2]}) — take Fields, not the Payload`);
  }
}

if (warnings.length) {
  console.warn(`\nWORKER_PAYLOAD (warn, ${warnings.length}): Workers must take Fields (D3).`);
  for (const line of warnings) console.warn(line);
  console.warn("  -> Read-checked for now; will become a hard gate once triaged.");
}
