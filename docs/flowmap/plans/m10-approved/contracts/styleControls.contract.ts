// @flowmap-contract styleControls kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initStyleControls } from './styleControls';
export type _p_initStyleControls = Parameters<typeof initStyleControls>;
export type _r_initStyleControls = ReturnType<typeof initStyleControls>;
