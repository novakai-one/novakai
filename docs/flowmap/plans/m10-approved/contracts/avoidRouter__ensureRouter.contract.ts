// @flowmap-contract avoidRouter__ensureRouter kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { ensureRouter } from './avoidRouter__ensureRouter';
export type _p_ensureRouter = Parameters<typeof ensureRouter>;
export type _r_ensureRouter = ReturnType<typeof ensureRouter>;
