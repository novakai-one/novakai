// @flowmap-contract unfold__ufGroupConns kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { groupConns } from './unfold__ufGroupConns';
export type _p_groupConns = Parameters<typeof groupConns>;
export type _r_groupConns = ReturnType<typeof groupConns>;
