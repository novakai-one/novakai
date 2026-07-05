// @flowmap-contract exporter__initExport kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initExport } from './exporter__initExport';
export type _p_initExport = Parameters<typeof initExport>;
export type _r_initExport = ReturnType<typeof initExport>;
