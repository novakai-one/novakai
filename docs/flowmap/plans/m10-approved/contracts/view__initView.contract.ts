// @flowmap-contract view__initView kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initView } from './view__initView';
export type _p_initView = Parameters<typeof initView>;
export type _r_initView = ReturnType<typeof initView>;
