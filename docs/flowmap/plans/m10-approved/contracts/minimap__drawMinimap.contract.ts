// @flowmap-contract minimap__drawMinimap kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { drawMinimap } from './minimap__drawMinimap';
export type _p_drawMinimap = Parameters<typeof drawMinimap>;
export type _r_drawMinimap = ReturnType<typeof drawMinimap>;
