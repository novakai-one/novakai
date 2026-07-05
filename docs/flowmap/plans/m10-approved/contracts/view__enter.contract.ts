// @flowmap-contract view__enter kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { enter } from './view__enter';
export type _p_enter = Parameters<typeof enter>;
export type _r_enter = ReturnType<typeof enter>;
