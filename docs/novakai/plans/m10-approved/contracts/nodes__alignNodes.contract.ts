// @novakai-contract nodes__alignNodes kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { alignNodes } from './nodes__alignNodes';
export type _p_alignNodes = Parameters<typeof alignNodes>;
export type _r_alignNodes = ReturnType<typeof alignNodes>;
