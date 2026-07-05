// @flowmap-contract wires__labelAnchor kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { labelAnchor } from './wires__labelAnchor';
export type _p_labelAnchor = Parameters<typeof labelAnchor>;
export type _r_labelAnchor = ReturnType<typeof labelAnchor>;
