// @flowmap-contract unfold__ufCommit kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { commit } from './unfold__ufCommit';
export type _p_commit = Parameters<typeof commit>;
export type _r_commit = ReturnType<typeof commit>;
