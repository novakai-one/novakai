/* =====================================================================
   src-tree-hash.mjs — content hash of a directory's CURRENT working-tree
   state (tracked + untracked, .gitignore-respected, dirty-aware).
   ---------------------------------------------------------------------
   Built from git plumbing only, no custom hashing: `git add -A` into a
   scratch index (never touches the real index/HEAD), `git write-tree`
   to serialize it, then pull out the one subtree entry for `dir`. Two
   working trees with identical file content under `dir` always produce
   the same hash, committed or not — that content-vs-time distinction is
   the whole point (see ship-staleness.mjs).
   ===================================================================== */

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Returns the tree hash of `dir` (default 'src') as it stands in the
    working tree of `root` right now, or null if `dir` has no committable
    content (empty / entirely gitignored). Throws if `root` is not a git
    repo — callers already wrap staleness checks in a fail-open catch. */
export function srcTreeHash(root, dir = 'src') {
  const scratch = mkdtempSync(join(tmpdir(), 'novakai-src-hash-'));
  const idx = join(scratch, 'index');
  try {
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    const opts = { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };
    execSync(`git add -A -- ${dir}`, opts);
    const tree = execSync('git write-tree', opts).trim();
    const entry = execSync(`git ls-tree ${tree} -- ${dir}`, opts).trim();
    // "040000 tree <hash>\t<dir>" — no entry means dir is empty/all-ignored.
    return entry ? entry.split(/\s+/)[2] : null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
