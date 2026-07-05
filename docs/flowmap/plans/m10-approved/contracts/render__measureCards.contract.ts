// @flowmap-contract render__measureCards kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { measureCards } from './render__measureCards';
export type _p_measureCards = Parameters<typeof measureCards>;
export type _r_measureCards = ReturnType<typeof measureCards>;
