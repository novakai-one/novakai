// @flowmap-contract viewspec__reduceView kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { reduceView } from './viewspec__reduceView';
export type _p_reduceView = Parameters<typeof reduceView>;
export type _r_reduceView = ReturnType<typeof reduceView>;
