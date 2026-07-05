// @flowmap-contract files__loadMmdText kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { loadMmdText } from './files__loadMmdText';
export type _p_loadMmdText = Parameters<typeof loadMmdText>;
export type _r_loadMmdText = ReturnType<typeof loadMmdText>;
