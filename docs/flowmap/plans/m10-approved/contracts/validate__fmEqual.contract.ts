// @flowmap-contract validate__fmEqual kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { fmEqual } from './validate__fmEqual';
export type _p_fmEqual = Parameters<typeof fmEqual>;
export type _r_fmEqual = ReturnType<typeof fmEqual>;
