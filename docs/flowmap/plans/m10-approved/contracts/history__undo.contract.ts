// @flowmap-contract history__undo kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { undo } from './history__undo';
export type _p_undo = Parameters<typeof undo>;
export type _r_undo = ReturnType<typeof undo>;
