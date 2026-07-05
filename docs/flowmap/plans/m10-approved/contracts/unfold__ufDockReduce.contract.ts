// @flowmap-contract unfold__ufDockReduce kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { ufDockReduce } from './unfold__ufDockReduce';
export type _p_ufDockReduce = Parameters<typeof ufDockReduce>;
export type _r_ufDockReduce = ReturnType<typeof ufDockReduce>;
