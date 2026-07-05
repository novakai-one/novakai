// @flowmap-contract view__apply kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { apply } from './view__apply';
export type _p_apply = Parameters<typeof apply>;
export type _r_apply = ReturnType<typeof apply>;
