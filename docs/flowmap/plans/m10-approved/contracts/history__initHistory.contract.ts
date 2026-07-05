// @flowmap-contract history__initHistory kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initHistory } from './history__initHistory';
export type _p_initHistory = Parameters<typeof initHistory>;
export type _r_initHistory = ReturnType<typeof initHistory>;
