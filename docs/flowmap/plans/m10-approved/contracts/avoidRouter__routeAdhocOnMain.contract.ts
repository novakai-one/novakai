// @flowmap-contract avoidRouter__routeAdhocOnMain kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { routeAdhocOnMain } from './avoidRouter__routeAdhocOnMain';
export type _p_routeAdhocOnMain = Parameters<typeof routeAdhocOnMain>;
export type _r_routeAdhocOnMain = ReturnType<typeof routeAdhocOnMain>;
