// @flowmap-contract render__shapeMarkup kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { shapeMarkup } from './render__shapeMarkup';
export type _p_shapeMarkup = Parameters<typeof shapeMarkup>;
export type _r_shapeMarkup = ReturnType<typeof shapeMarkup>;
