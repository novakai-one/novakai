// @flowmap-contract wires__polyPath kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { polyPath } from './wires__polyPath';
export type _p_polyPath = Parameters<typeof polyPath>;
export type _r_polyPath = ReturnType<typeof polyPath>;
