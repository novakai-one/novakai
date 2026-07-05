// @flowmap-contract unfold__ufLiftSpec kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { LiftSpec } from './unfold__ufLiftSpec';
export type _keys_LiftSpec = keyof LiftSpec;
