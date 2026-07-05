// @flowmap-contract exporter__exportPNG kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { exportPNG } from './exporter__exportPNG';
export type _p_exportPNG = Parameters<typeof exportPNG>;
export type _r_exportPNG = ReturnType<typeof exportPNG>;
