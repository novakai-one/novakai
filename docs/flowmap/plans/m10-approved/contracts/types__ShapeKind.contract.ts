// @flowmap-contract types__ShapeKind kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { ShapeKind } from './types__ShapeKind';
export type _keys_ShapeKind = keyof ShapeKind;
