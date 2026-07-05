// @flowmap-contract plan__normalizePlan kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { normalizePlan } from './plan__normalizePlan';
export type _p_normalizePlan = Parameters<typeof normalizePlan>;
export type _r_normalizePlan = ReturnType<typeof normalizePlan>;
