// @flowmap-contract render__buildFmCard kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { buildFmCard } from './render__buildFmCard';
export type _p_buildFmCard = Parameters<typeof buildFmCard>;
export type _r_buildFmCard = ReturnType<typeof buildFmCard>;
