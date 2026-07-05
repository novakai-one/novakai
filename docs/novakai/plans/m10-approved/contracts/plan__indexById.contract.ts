// @novakai-contract plan__indexById kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { indexById } from './plan__indexById';
export type _p_indexById = Parameters<typeof indexById>;
export type _r_indexById = ReturnType<typeof indexById>;
