// @flowmap-contract frontmatter__matchFrontmatterLine kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { matchFrontmatterLine } from './frontmatter__matchFrontmatterLine';
export type _p_matchFrontmatterLine = Parameters<typeof matchFrontmatterLine>;
export type _r_matchFrontmatterLine = ReturnType<typeof matchFrontmatterLine>;
