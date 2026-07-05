// @flowmap-contract unfold__ufTrustLayer kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { trustLayer } from './unfold__ufTrustLayer';
export type _p_trustLayer = Parameters<typeof trustLayer>;
export type _r_trustLayer = ReturnType<typeof trustLayer>;
