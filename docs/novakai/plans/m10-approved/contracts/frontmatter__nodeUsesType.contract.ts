// @novakai-contract frontmatter__nodeUsesType kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { nodeUsesType } from './frontmatter__nodeUsesType';
export type _p_nodeUsesType = Parameters<typeof nodeUsesType>;
export type _r_nodeUsesType = ReturnType<typeof nodeUsesType>;
