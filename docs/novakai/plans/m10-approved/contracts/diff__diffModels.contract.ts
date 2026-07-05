// @novakai-contract diff__diffModels kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { diffModels } from './diff__diffModels';
export type _p_diffModels = Parameters<typeof diffModels>;
export type _r_diffModels = ReturnType<typeof diffModels>;
