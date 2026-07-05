// @flowmap-contract unfold__ufStageMode kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { stageMode } from './unfold__ufStageMode';
export type _p_stageMode = Parameters<typeof stageMode>;
export type _r_stageMode = ReturnType<typeof stageMode>;
