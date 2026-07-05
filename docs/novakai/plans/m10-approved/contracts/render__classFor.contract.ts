// @novakai-contract render__classFor kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { classFor } from './render__classFor';
export type _p_classFor = Parameters<typeof classFor>;
export type _r_classFor = ReturnType<typeof classFor>;
