// @flowmap-contract unfold__ufLiftEdge kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { LiftEdge } from './unfold__ufLiftEdge';
export type _keys_LiftEdge = keyof LiftEdge;
