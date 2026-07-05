// @novakai-contract viewspec__emptyViewSpec kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { emptyViewSpec } from './viewspec__emptyViewSpec';
export type _p_emptyViewSpec = Parameters<typeof emptyViewSpec>;
export type _r_emptyViewSpec = ReturnType<typeof emptyViewSpec>;
