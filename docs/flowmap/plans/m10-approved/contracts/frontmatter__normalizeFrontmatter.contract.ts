// @flowmap-contract frontmatter__normalizeFrontmatter kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { normalizeFrontmatter } from './frontmatter__normalizeFrontmatter';
export type _p_normalizeFrontmatter = Parameters<typeof normalizeFrontmatter>;
export type _r_normalizeFrontmatter = ReturnType<typeof normalizeFrontmatter>;
