// @flowmap-contract unfold__ufBuild kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { build } from './unfold__ufBuild';
export type _p_build = Parameters<typeof build>;
export type _r_build = ReturnType<typeof build>;
