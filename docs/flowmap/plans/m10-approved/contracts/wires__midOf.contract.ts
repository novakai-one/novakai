// @flowmap-contract wires__midOf kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { midOf } from './wires__midOf';
export type _p_midOf = Parameters<typeof midOf>;
export type _r_midOf = ReturnType<typeof midOf>;
