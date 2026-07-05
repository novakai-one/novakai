// @flowmap-contract slice__SliceApi kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { SliceApi } from './slice__SliceApi';
export type _keys_SliceApi = keyof SliceApi;
