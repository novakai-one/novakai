// @novakai-contract clipboard__pasteClip kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { pasteClip } from './clipboard__pasteClip';
export type _p_pasteClip = Parameters<typeof pasteClip>;
export type _r_pasteClip = ReturnType<typeof pasteClip>;
