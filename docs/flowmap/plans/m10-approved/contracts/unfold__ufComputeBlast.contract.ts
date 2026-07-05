// @flowmap-contract unfold__ufComputeBlast kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { computeBlast } from './unfold__ufComputeBlast';
export type _p_computeBlast = Parameters<typeof computeBlast>;
export type _r_computeBlast = ReturnType<typeof computeBlast>;
