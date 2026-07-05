// @flowmap-contract pointer__setLinkMode kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { setLinkMode } from './pointer__setLinkMode';
export type _p_setLinkMode = Parameters<typeof setLinkMode>;
export type _r_setLinkMode = ReturnType<typeof setLinkMode>;
