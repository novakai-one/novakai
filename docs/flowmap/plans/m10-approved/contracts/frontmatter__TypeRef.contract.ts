// @flowmap-contract frontmatter__TypeRef kind=type
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import type { TypeRef } from './frontmatter__TypeRef';
export type _keys_TypeRef = keyof TypeRef;
