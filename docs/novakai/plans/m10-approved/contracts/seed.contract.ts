// @novakai-contract seed kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { seed } from './seed';
export type _p_seed = Parameters<typeof seed>;
export type _r_seed = ReturnType<typeof seed>;
