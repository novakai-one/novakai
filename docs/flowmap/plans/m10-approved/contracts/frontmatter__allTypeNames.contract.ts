// @flowmap-contract frontmatter__allTypeNames kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { allTypeNames } from './frontmatter__allTypeNames';
export type _p_allTypeNames = Parameters<typeof allTypeNames>;
export type _r_allTypeNames = ReturnType<typeof allTypeNames>;
