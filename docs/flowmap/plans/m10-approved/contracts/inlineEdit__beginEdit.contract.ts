// @flowmap-contract inlineEdit__beginEdit kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { beginEdit } from './inlineEdit__beginEdit';
export type _p_beginEdit = Parameters<typeof beginEdit>;
export type _r_beginEdit = ReturnType<typeof beginEdit>;
