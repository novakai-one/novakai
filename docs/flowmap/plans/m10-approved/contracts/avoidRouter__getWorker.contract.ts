// @flowmap-contract avoidRouter__getWorker kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { getWorker } from './avoidRouter__getWorker';
export type _p_getWorker = Parameters<typeof getWorker>;
export type _r_getWorker = ReturnType<typeof getWorker>;
