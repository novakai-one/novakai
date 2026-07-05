// @flowmap-contract types__Frontmatter kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { Frontmatter } from './types__Frontmatter';
export type _keys_Frontmatter = keyof Frontmatter;
