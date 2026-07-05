// @flowmap-contract unfold__ufEnterStagger kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { enterStagger } from './unfold__ufEnterStagger';
export type _p_enterStagger = Parameters<typeof enterStagger>;
export type _r_enterStagger = ReturnType<typeof enterStagger>;
