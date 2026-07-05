// @novakai-contract config__esc kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { esc } from './config__esc';
export type _p_esc = Parameters<typeof esc>;
export type _r_esc = ReturnType<typeof esc>;
