// @flowmap-contract clipboard__copySel kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { copySel } from './clipboard__copySel';
export type _p_copySel = Parameters<typeof copySel>;
export type _r_copySel = ReturnType<typeof copySel>;
