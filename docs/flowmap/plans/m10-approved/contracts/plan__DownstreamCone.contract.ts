// @flowmap-contract plan__downstreamCone kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { downstreamCone } from './plan__downstreamCone';
export type _p_downstreamCone = Parameters<typeof downstreamCone>;
export type _r_downstreamCone = ReturnType<typeof downstreamCone>;
