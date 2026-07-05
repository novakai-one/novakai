// @flowmap-contract unfold__ufSelectGroup kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { selectGroup } from './unfold__ufSelectGroup';
export type _p_selectGroup = Parameters<typeof selectGroup>;
export type _r_selectGroup = ReturnType<typeof selectGroup>;
