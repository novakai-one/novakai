// @flowmap-contract persistence__initPersistence kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initPersistence } from './persistence__initPersistence';
export type _p_initPersistence = Parameters<typeof initPersistence>;
export type _r_initPersistence = ReturnType<typeof initPersistence>;
