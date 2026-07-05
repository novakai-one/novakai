// @flowmap-contract history__restore kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { restore } from './history__restore';
export type _p_restore = Parameters<typeof restore>;
export type _r_restore = ReturnType<typeof restore>;
