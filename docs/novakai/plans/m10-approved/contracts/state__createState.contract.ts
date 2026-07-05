// @novakai-contract state__createState kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { createState } from './state__createState';
export type _p_createState = Parameters<typeof createState>;
export type _r_createState = ReturnType<typeof createState>;
