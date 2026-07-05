// @flowmap-contract unfold__ufWirePath kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { wirePath } from './unfold__ufWirePath';
export type _p_wirePath = Parameters<typeof wirePath>;
export type _r_wirePath = ReturnType<typeof wirePath>;
