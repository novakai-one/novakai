// @flowmap-contract persistence__loadPersisted kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { loadPersisted } from './persistence__loadPersisted';
export type _p_loadPersisted = Parameters<typeof loadPersisted>;
export type _r_loadPersisted = ReturnType<typeof loadPersisted>;
