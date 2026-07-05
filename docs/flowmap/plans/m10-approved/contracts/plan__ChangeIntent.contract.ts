// @flowmap-contract plan__ChangeIntent kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { ChangeIntent } from './plan__ChangeIntent';
export type _keys_ChangeIntent = keyof ChangeIntent;
