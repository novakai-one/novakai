// @flowmap-contract unfold__ufRenameInPlace kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { renameInPlace } from './unfold__ufRenameInPlace';
export type _p_renameInPlace = Parameters<typeof renameInPlace>;
export type _r_renameInPlace = ReturnType<typeof renameInPlace>;
