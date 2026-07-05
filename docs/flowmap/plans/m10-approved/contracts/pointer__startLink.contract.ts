// @flowmap-contract pointer__startLink kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { startLink } from './pointer__startLink';
export type _p_startLink = Parameters<typeof startLink>;
export type _r_startLink = ReturnType<typeof startLink>;
