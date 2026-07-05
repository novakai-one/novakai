// @novakai-contract layout__autoLayout kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { autoLayout } from './layout__autoLayout';
export type _p_autoLayout = Parameters<typeof autoLayout>;
export type _r_autoLayout = ReturnType<typeof autoLayout>;
