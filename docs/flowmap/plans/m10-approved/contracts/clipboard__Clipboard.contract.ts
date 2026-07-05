// @flowmap-contract clipboard__Clipboard kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { Clipboard } from './clipboard__Clipboard';
export type _keys_Clipboard = keyof Clipboard;
