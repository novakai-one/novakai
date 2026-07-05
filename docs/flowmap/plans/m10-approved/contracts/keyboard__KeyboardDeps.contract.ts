// @flowmap-contract keyboard__KeyboardDeps kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { KeyboardDeps } from './keyboard__KeyboardDeps';
export type _keys_KeyboardDeps = keyof KeyboardDeps;
