// @flowmap-contract render__renderFn kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { render } from './render__renderFn';
export type _p_render = Parameters<typeof render>;
export type _r_render = ReturnType<typeof render>;
