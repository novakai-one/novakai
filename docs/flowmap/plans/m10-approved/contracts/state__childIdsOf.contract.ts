// @flowmap-contract state__childIdsOf kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { childIdsOf } from './state__childIdsOf';
export type _p_childIdsOf = Parameters<typeof childIdsOf>;
export type _r_childIdsOf = ReturnType<typeof childIdsOf>;
