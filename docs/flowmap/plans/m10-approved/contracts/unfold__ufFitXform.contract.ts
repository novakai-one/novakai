// @flowmap-contract unfold__ufFitXform kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { ufFitXform } from './unfold__ufFitXform';
export type _p_ufFitXform = Parameters<typeof ufFitXform>;
export type _r_ufFitXform = ReturnType<typeof ufFitXform>;
