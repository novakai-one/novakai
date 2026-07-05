// @novakai-contract render__scheduleMeasure kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { scheduleMeasure } from './render__scheduleMeasure';
export type _p_scheduleMeasure = Parameters<typeof scheduleMeasure>;
export type _r_scheduleMeasure = ReturnType<typeof scheduleMeasure>;
