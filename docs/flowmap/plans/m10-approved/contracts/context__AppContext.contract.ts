// @flowmap-contract context__AppContext kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { AppContext } from './context__AppContext';
export type _keys_AppContext = keyof AppContext;
