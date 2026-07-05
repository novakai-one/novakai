// @flowmap-contract unfold__ufEscAction kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { ufEscAction } from './unfold__ufEscAction';
export type _p_ufEscAction = Parameters<typeof ufEscAction>;
export type _r_ufEscAction = ReturnType<typeof ufEscAction>;
