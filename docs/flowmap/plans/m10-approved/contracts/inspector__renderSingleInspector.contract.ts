// @flowmap-contract inspector__renderSingleInspector kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { renderSingleInspector } from './inspector__renderSingleInspector';
export type _p_renderSingleInspector = Parameters<typeof renderSingleInspector>;
export type _r_renderSingleInspector = ReturnType<typeof renderSingleInspector>;
