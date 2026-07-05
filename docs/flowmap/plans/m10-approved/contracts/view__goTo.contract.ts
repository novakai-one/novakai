// @flowmap-contract view__goTo kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { goTo } from './view__goTo';
export type _p_goTo = Parameters<typeof goTo>;
export type _r_goTo = ReturnType<typeof goTo>;
