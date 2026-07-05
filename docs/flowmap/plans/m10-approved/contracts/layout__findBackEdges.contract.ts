// @flowmap-contract layout__findBackEdges kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { findBackEdges } from './layout__findBackEdges';
export type _p_findBackEdges = Parameters<typeof findBackEdges>;
export type _r_findBackEdges = ReturnType<typeof findBackEdges>;
