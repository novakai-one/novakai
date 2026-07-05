// @flowmap-contract validate__inParentCycle kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { inParentCycle } from './validate__inParentCycle';
export type _p_inParentCycle = Parameters<typeof inParentCycle>;
export type _r_inParentCycle = ReturnType<typeof inParentCycle>;
