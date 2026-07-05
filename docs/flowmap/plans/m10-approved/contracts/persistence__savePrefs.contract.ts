// @flowmap-contract persistence__savePrefs kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { savePrefs } from './persistence__savePrefs';
export type _p_savePrefs = Parameters<typeof savePrefs>;
export type _r_savePrefs = ReturnType<typeof savePrefs>;
