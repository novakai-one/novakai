// @flowmap-contract inspector__updateSource kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { updateSource } from './inspector__updateSource';
export type _p_updateSource = Parameters<typeof updateSource>;
export type _r_updateSource = ReturnType<typeof updateSource>;
