// @flowmap-contract unfold__ufOpen kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { open } from './unfold__ufOpen';
export type _p_open = Parameters<typeof open>;
export type _r_open = ReturnType<typeof open>;
