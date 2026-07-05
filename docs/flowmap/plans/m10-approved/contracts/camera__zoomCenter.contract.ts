// @flowmap-contract camera__zoomCenter kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { zoomCenter } from './camera__zoomCenter';
export type _p_zoomCenter = Parameters<typeof zoomCenter>;
export type _r_zoomCenter = ReturnType<typeof zoomCenter>;
