// @flowmap-contract keyboard__editing kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { editing } from './keyboard__editing';
export type _p_editing = Parameters<typeof editing>;
export type _r_editing = ReturnType<typeof editing>;
