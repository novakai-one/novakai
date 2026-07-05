// @flowmap-contract render__nodeSig kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { nodeSig } from './render__nodeSig';
export type _p_nodeSig = Parameters<typeof nodeSig>;
export type _r_nodeSig = ReturnType<typeof nodeSig>;
