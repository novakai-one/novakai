// @flowmap-contract context__createHooks kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { createHooks } from './context__createHooks';
export type _p_createHooks = Parameters<typeof createHooks>;
export type _r_createHooks = ReturnType<typeof createHooks>;
