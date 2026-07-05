// @flowmap-contract exporter__exportSVG kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { exportSVG } from './exporter__exportSVG';
export type _p_exportSVG = Parameters<typeof exportSVG>;
export type _r_exportSVG = ReturnType<typeof exportSVG>;
