// @flowmap-contract history__createHistory kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { createHistory } from './history__createHistory';
export type _p_createHistory = Parameters<typeof createHistory>;
export type _r_createHistory = ReturnType<typeof createHistory>;
