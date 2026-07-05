// @flowmap-contract state__StateStore kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { StateStore } from './state__StateStore';
export type _keys_StateStore = keyof StateStore;
