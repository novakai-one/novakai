// @flowmap-contract plan__ChangeTarget kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { ChangeTarget } from './plan__ChangeTarget';
export type _keys_ChangeTarget = keyof ChangeTarget;
