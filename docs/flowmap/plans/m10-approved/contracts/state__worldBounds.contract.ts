// @flowmap-contract state__worldBounds kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { worldBounds } from './state__worldBounds';
export type _p_worldBounds = Parameters<typeof worldBounds>;
export type _r_worldBounds = ReturnType<typeof worldBounds>;
