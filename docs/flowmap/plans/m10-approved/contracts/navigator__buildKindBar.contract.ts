// @flowmap-contract navigator__buildKindBar kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { buildKindBar } from './navigator__buildKindBar';
export type _p_buildKindBar = Parameters<typeof buildKindBar>;
export type _r_buildKindBar = ReturnType<typeof buildKindBar>;
