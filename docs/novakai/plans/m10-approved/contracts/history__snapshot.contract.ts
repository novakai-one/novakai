// @novakai-contract history__snapshot kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { snapshot } from './history__snapshot';
export type _p_snapshot = Parameters<typeof snapshot>;
export type _r_snapshot = ReturnType<typeof snapshot>;
