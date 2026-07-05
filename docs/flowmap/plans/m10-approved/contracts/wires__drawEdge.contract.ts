// @flowmap-contract wires__drawEdge kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { drawEdge } from './wires__drawEdge';
export type _p_drawEdge = Parameters<typeof drawEdge>;
export type _r_drawEdge = ReturnType<typeof drawEdge>;
