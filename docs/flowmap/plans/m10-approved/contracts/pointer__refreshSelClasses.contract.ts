// @flowmap-contract pointer__refreshSelClasses kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { refreshSelClasses } from './pointer__refreshSelClasses';
export type _p_refreshSelClasses = Parameters<typeof refreshSelClasses>;
export type _r_refreshSelClasses = ReturnType<typeof refreshSelClasses>;
