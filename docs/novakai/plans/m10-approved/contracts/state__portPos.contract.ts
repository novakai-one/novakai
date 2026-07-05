// @novakai-contract state__portPos kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { portPos } from './state__portPos';
export type _p_portPos = Parameters<typeof portPos>;
export type _r_portPos = ReturnType<typeof portPos>;
