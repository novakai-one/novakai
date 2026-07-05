// @novakai-contract history__pushHistory kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { pushHistory } from './history__pushHistory';
export type _p_pushHistory = Parameters<typeof pushHistory>;
export type _r_pushHistory = ReturnType<typeof pushHistory>;
