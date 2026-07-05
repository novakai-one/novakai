// @flowmap-contract render__initRender kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initRender } from './render__initRender';
export type _p_initRender = Parameters<typeof initRender>;
export type _r_initRender = ReturnType<typeof initRender>;
