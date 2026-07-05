// @flowmap-contract plan__ConeNode kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { ConeNode } from './plan__ConeNode';
export type _keys_ConeNode = keyof ConeNode;
