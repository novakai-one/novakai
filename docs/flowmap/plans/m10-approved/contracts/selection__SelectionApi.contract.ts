// @flowmap-contract selection__SelectionApi kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { SelectionApi } from './selection__SelectionApi';
export type _keys_SelectionApi = keyof SelectionApi;
