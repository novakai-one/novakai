// @flowmap-contract pointer__showAlignGuides kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { showAlignGuides } from './pointer__showAlignGuides';
export type _p_showAlignGuides = Parameters<typeof showAlignGuides>;
export type _r_showAlignGuides = ReturnType<typeof showAlignGuides>;
