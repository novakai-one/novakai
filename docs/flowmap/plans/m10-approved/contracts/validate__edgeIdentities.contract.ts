// @flowmap-contract validate__edgeIdentities kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { edgeIdentities } from './validate__edgeIdentities';
export type _p_edgeIdentities = Parameters<typeof edgeIdentities>;
export type _r_edgeIdentities = ReturnType<typeof edgeIdentities>;
