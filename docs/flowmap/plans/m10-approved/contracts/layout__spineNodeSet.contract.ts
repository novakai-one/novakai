// @flowmap-contract layout__spineNodeSet kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { spineNodeSet } from './layout__spineNodeSet';
export type _p_spineNodeSet = Parameters<typeof spineNodeSet>;
export type _r_spineNodeSet = ReturnType<typeof spineNodeSet>;
