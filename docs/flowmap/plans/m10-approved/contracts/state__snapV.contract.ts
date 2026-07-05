// @flowmap-contract state__snapV kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { snapV } from './state__snapV';
export type _p_snapV = Parameters<typeof snapV>;
export type _r_snapV = ReturnType<typeof snapV>;
