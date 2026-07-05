// @novakai-contract state__containerOf kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { containerOf } from './state__containerOf';
export type _p_containerOf = Parameters<typeof containerOf>;
export type _r_containerOf = ReturnType<typeof containerOf>;
