// @flowmap-contract clipboard__initClipboard kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initClipboard } from './clipboard__initClipboard';
export type _p_initClipboard = Parameters<typeof initClipboard>;
export type _r_initClipboard = ReturnType<typeof initClipboard>;
