// @flowmap-contract state__nodeFootprint kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { nodeFootprint } from './state__nodeFootprint';
export type _p_nodeFootprint = Parameters<typeof nodeFootprint>;
export type _r_nodeFootprint = ReturnType<typeof nodeFootprint>;
