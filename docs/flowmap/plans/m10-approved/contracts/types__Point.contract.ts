// @flowmap-contract types__Point kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { Point } from './types__Point';
export type _keys_Point = keyof Point;
