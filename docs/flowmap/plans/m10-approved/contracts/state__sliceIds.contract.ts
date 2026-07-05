// @flowmap-contract state__sliceIds kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { sliceIds } from './state__sliceIds';
export type _p_sliceIds = Parameters<typeof sliceIds>;
export type _r_sliceIds = ReturnType<typeof sliceIds>;
