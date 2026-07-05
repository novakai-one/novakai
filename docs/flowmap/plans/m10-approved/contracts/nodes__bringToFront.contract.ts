// @flowmap-contract nodes__bringToFront kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { bringToFront } from './nodes__bringToFront';
export type _p_bringToFront = Parameters<typeof bringToFront>;
export type _r_bringToFront = ReturnType<typeof bringToFront>;
