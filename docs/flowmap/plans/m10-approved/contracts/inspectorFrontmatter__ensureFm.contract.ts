// @flowmap-contract inspectorFrontmatter__ensureFm kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { ensureFm } from './inspectorFrontmatter__ensureFm';
export type _p_ensureFm = Parameters<typeof ensureFm>;
export type _r_ensureFm = ReturnType<typeof ensureFm>;
