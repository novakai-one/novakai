// @novakai-contract selection__selectAll kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { selectAll } from './selection__selectAll';
export type _p_selectAll = Parameters<typeof selectAll>;
export type _r_selectAll = ReturnType<typeof selectAll>;
