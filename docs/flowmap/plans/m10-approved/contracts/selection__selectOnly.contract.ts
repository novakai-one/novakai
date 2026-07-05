// @flowmap-contract selection__selectOnly kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { selectOnly } from './selection__selectOnly';
export type _p_selectOnly = Parameters<typeof selectOnly>;
export type _r_selectOnly = ReturnType<typeof selectOnly>;
