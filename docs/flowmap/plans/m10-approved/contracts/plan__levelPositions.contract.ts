// @flowmap-contract plan__levelPositions kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { levelPositions } from './plan__levelPositions';
export type _p_levelPositions = Parameters<typeof levelPositions>;
export type _r_levelPositions = ReturnType<typeof levelPositions>;
