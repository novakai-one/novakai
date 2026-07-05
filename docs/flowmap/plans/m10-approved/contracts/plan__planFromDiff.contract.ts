// @flowmap-contract plan__planFromDiff kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { planFromDiff } from './plan__planFromDiff';
export type _p_planFromDiff = Parameters<typeof planFromDiff>;
export type _r_planFromDiff = ReturnType<typeof planFromDiff>;
