// @flowmap-contract unfold__ufProxies kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { stageProxies } from './unfold__ufProxies';
export type _p_stageProxies = Parameters<typeof stageProxies>;
export type _r_stageProxies = ReturnType<typeof stageProxies>;
