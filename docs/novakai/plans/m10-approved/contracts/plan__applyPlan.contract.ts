// @novakai-contract plan__applyPlan kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { applyPlan } from './plan__applyPlan';
export type _p_applyPlan = Parameters<typeof applyPlan>;
export type _r_applyPlan = ReturnType<typeof applyPlan>;
