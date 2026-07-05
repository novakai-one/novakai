// @flowmap-contract plan__synthNode kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { synthNode } from './plan__synthNode';
export type _p_synthNode = Parameters<typeof synthNode>;
export type _r_synthNode = ReturnType<typeof synthNode>;
