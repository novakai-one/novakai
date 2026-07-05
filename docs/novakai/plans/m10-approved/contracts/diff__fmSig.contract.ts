// @novakai-contract diff__fmSig kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { fmSig } from './diff__fmSig';
export type _p_fmSig = Parameters<typeof fmSig>;
export type _r_fmSig = ReturnType<typeof fmSig>;
