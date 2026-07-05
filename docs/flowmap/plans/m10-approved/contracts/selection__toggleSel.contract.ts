// @flowmap-contract selection__toggleSel kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { toggleSel } from './selection__toggleSel';
export type _p_toggleSel = Parameters<typeof toggleSel>;
export type _r_toggleSel = ReturnType<typeof toggleSel>;
