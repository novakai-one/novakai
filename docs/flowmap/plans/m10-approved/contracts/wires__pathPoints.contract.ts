// @flowmap-contract wires__pathPoints kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { pathPoints } from './wires__pathPoints';
export type _p_pathPoints = Parameters<typeof pathPoints>;
export type _r_pathPoints = ReturnType<typeof pathPoints>;
