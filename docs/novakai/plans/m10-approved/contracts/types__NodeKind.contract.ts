// @novakai-contract types__NodeKind kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { NodeKind } from './types__NodeKind';
export type _keys_NodeKind = keyof NodeKind;
