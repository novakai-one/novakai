// @flowmap-contract unfold__ufPersistView kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { persistView } from './unfold__ufPersistView';
export type _p_persistView = Parameters<typeof persistView>;
export type _r_persistView = ReturnType<typeof persistView>;
