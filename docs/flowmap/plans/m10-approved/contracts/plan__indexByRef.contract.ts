// @flowmap-contract plan__indexByRef kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { indexByRef } from './plan__indexByRef';
export type _p_indexByRef = Parameters<typeof indexByRef>;
export type _r_indexByRef = ReturnType<typeof indexByRef>;
