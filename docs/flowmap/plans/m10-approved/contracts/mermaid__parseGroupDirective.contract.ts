// @flowmap-contract mermaid__parseGroupDirective kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { parseGroupDirective } from './mermaid__parseGroupDirective';
export type _p_parseGroupDirective = Parameters<typeof parseGroupDirective>;
export type _r_parseGroupDirective = ReturnType<typeof parseGroupDirective>;
