// @novakai-contract pointer__startPan kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { startPan } from './pointer__startPan';
export type _p_startPan = Parameters<typeof startPan>;
export type _r_startPan = ReturnType<typeof startPan>;
