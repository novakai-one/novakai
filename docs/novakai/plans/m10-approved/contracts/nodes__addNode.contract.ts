// @novakai-contract nodes__addNode kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { addNode } from './nodes__addNode';
export type _p_addNode = Parameters<typeof addNode>;
export type _r_addNode = ReturnType<typeof addNode>;
