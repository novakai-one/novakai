// @flowmap-contract layout__captureGroups kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { captureGroups } from './layout__captureGroups';
export type _p_captureGroups = Parameters<typeof captureGroups>;
export type _r_captureGroups = ReturnType<typeof captureGroups>;
