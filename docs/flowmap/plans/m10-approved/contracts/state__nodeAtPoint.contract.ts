// @flowmap-contract state__nodeAtPoint kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { nodeAtPoint } from './state__nodeAtPoint';
export type _p_nodeAtPoint = Parameters<typeof nodeAtPoint>;
export type _r_nodeAtPoint = ReturnType<typeof nodeAtPoint>;
