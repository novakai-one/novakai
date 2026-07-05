// @flowmap-contract nodes__wrapInGroup kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { wrapInGroup } from './nodes__wrapInGroup';
export type _p_wrapInGroup = Parameters<typeof wrapInGroup>;
export type _r_wrapInGroup = ReturnType<typeof wrapInGroup>;
