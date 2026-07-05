// @flowmap-contract plan__emptyPlan kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { emptyPlan } from './plan__emptyPlan';
export type _p_emptyPlan = Parameters<typeof emptyPlan>;
export type _r_emptyPlan = ReturnType<typeof emptyPlan>;
