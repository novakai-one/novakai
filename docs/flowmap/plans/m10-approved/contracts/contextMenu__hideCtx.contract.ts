// @flowmap-contract contextMenu__hideCtx kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { hideCtx } from './contextMenu__hideCtx';
export type _p_hideCtx = Parameters<typeof hideCtx>;
export type _r_hideCtx = ReturnType<typeof hideCtx>;
