// @flowmap-contract camera__zoomAt kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { zoomAt } from './camera__zoomAt';
export type _p_zoomAt = Parameters<typeof zoomAt>;
export type _r_zoomAt = ReturnType<typeof zoomAt>;
