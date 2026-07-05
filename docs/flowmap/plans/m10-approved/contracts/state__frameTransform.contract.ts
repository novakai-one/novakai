// @flowmap-contract state__frameTransform kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { frameTransform } from './state__frameTransform';
export type _p_frameTransform = Parameters<typeof frameTransform>;
export type _r_frameTransform = ReturnType<typeof frameTransform>;
