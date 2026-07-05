// @flowmap-contract unfold__ufVerbAllowed kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { ufVerbAllowed } from './unfold__ufVerbAllowed';
export type _p_ufVerbAllowed = Parameters<typeof ufVerbAllowed>;
export type _r_ufVerbAllowed = ReturnType<typeof ufVerbAllowed>;
