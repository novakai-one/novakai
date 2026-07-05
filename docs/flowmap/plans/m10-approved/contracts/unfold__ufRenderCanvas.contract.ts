// @flowmap-contract unfold__ufRenderCanvas kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { renderCanvas } from './unfold__ufRenderCanvas';
export type _p_renderCanvas = Parameters<typeof renderCanvas>;
export type _r_renderCanvas = ReturnType<typeof renderCanvas>;
