// @flowmap-contract contextMenu__showCtx kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { showCtx } from './contextMenu__showCtx';
export type _p_showCtx = Parameters<typeof showCtx>;
export type _r_showCtx = ReturnType<typeof showCtx>;
