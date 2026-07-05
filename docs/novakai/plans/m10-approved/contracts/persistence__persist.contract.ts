// @novakai-contract persistence__persist kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { persist } from './persistence__persist';
export type _p_persist = Parameters<typeof persist>;
export type _r_persist = ReturnType<typeof persist>;
