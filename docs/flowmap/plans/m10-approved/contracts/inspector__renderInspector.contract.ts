// @flowmap-contract inspector__renderInspector kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { renderInspector } from './inspector__renderInspector';
export type _p_renderInspector = Parameters<typeof renderInspector>;
export type _r_renderInspector = ReturnType<typeof renderInspector>;
