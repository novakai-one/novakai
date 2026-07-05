// @flowmap-contract state__Footprint kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { Footprint } from './state__Footprint';
export type _keys_Footprint = keyof Footprint;
