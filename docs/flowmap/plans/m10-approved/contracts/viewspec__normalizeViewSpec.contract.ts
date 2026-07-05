// @flowmap-contract viewspec__normalizeViewSpec kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { normalizeViewSpec } from './viewspec__normalizeViewSpec';
export type _p_normalizeViewSpec = Parameters<typeof normalizeViewSpec>;
export type _r_normalizeViewSpec = ReturnType<typeof normalizeViewSpec>;
