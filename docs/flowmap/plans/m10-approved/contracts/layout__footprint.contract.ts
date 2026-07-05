// @flowmap-contract layout__footprint kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { footprint } from './layout__footprint';
export type _p_footprint = Parameters<typeof footprint>;
export type _r_footprint = ReturnType<typeof footprint>;
