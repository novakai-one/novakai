// @flowmap-contract persistence__PersistenceApi kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { PersistenceApi } from './persistence__PersistenceApi';
export type _keys_PersistenceApi = keyof PersistenceApi;
