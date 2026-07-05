// @flowmap-contract layout__forwardGraph kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { forwardGraph } from './layout__forwardGraph';
export type _p_forwardGraph = Parameters<typeof forwardGraph>;
export type _r_forwardGraph = ReturnType<typeof forwardGraph>;
