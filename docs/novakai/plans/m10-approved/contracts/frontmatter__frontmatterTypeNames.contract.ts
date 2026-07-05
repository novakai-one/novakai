// @novakai-contract frontmatter__frontmatterTypeNames kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { frontmatterTypeNames } from './frontmatter__frontmatterTypeNames';
export type _p_frontmatterTypeNames = Parameters<typeof frontmatterTypeNames>;
export type _r_frontmatterTypeNames = ReturnType<typeof frontmatterTypeNames>;
