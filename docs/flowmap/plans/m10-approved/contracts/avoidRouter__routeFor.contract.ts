// @flowmap-contract avoidRouter__routeFor kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { routeFor } from './avoidRouter__routeFor';
export type _p_routeFor = Parameters<typeof routeFor>;
export type _r_routeFor = ReturnType<typeof routeFor>;
