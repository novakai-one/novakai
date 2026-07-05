// @novakai-contract frontmatter__emptyInterface kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { emptyInterface } from './frontmatter__emptyInterface';
export type _p_emptyInterface = Parameters<typeof emptyInterface>;
export type _r_emptyInterface = ReturnType<typeof emptyInterface>;
