// @flowmap-contract mermaid__sync kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { sync } from './mermaid__sync';
export type _p_sync = Parameters<typeof sync>;
export type _r_sync = ReturnType<typeof sync>;
