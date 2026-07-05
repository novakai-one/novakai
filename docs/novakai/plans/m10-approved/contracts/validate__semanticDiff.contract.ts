// @novakai-contract validate__semanticDiff kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { semanticDiff } from './validate__semanticDiff';
export type _p_semanticDiff = Parameters<typeof semanticDiff>;
export type _r_semanticDiff = ReturnType<typeof semanticDiff>;
