// @flowmap-contract diff__edgeKey kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { edgeKey } from './diff__edgeKey';
export type _p_edgeKey = Parameters<typeof edgeKey>;
export type _r_edgeKey = ReturnType<typeof edgeKey>;
