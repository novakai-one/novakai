// @flowmap-contract viewspec__ViewSpec kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { ViewSpec } from './viewspec__ViewSpec';
export type _keys_ViewSpec = keyof ViewSpec;
