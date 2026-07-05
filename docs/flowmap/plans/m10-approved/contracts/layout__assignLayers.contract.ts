// @flowmap-contract layout__assignLayers kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { assignLayers } from './layout__assignLayers';
export type _p_assignLayers = Parameters<typeof assignLayers>;
export type _r_assignLayers = ReturnType<typeof assignLayers>;
