// @flowmap-contract plan__Plan kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { Plan } from './plan__Plan';
export type _keys_Plan = keyof Plan;
