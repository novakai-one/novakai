// @novakai-contract frontmatter__parseTypeRef kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { parseTypeRef } from './frontmatter__parseTypeRef';
export type _p_parseTypeRef = Parameters<typeof parseTypeRef>;
export type _r_parseTypeRef = ReturnType<typeof parseTypeRef>;
