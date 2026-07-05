// @flowmap-contract state__nodeCenter kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { nodeCenter } from './state__nodeCenter';
export type _p_nodeCenter = Parameters<typeof nodeCenter>;
export type _r_nodeCenter = ReturnType<typeof nodeCenter>;
