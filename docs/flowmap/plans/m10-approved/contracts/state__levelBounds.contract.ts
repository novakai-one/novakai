// @flowmap-contract state__levelBounds kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { levelBounds } from './state__levelBounds';
export type _p_levelBounds = Parameters<typeof levelBounds>;
export type _r_levelBounds = ReturnType<typeof levelBounds>;
