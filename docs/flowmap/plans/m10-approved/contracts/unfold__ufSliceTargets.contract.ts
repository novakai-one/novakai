// @flowmap-contract unfold__ufSliceTargets kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { ufSliceTargets } from './unfold__ufSliceTargets';
export type _p_ufSliceTargets = Parameters<typeof ufSliceTargets>;
export type _r_ufSliceTargets = ReturnType<typeof ufSliceTargets>;
