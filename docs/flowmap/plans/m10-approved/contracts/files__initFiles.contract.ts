// @flowmap-contract files__initFiles kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initFiles } from './files__initFiles';
export type _p_initFiles = Parameters<typeof initFiles>;
export type _r_initFiles = ReturnType<typeof initFiles>;
