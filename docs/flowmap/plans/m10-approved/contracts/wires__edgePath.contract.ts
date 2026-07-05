// @flowmap-contract wires__edgePath kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { edgePath } from './wires__edgePath';
export type _p_edgePath = Parameters<typeof edgePath>;
export type _r_edgePath = ReturnType<typeof edgePath>;
