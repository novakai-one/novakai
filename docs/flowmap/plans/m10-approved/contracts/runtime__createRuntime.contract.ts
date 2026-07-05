// @flowmap-contract runtime__createRuntime kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { createRuntime } from './runtime__createRuntime';
export type _p_createRuntime = Parameters<typeof createRuntime>;
export type _r_createRuntime = ReturnType<typeof createRuntime>;
