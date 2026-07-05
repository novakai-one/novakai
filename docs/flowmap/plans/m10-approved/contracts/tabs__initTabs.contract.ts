// @flowmap-contract tabs__initTabs kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { initTabs } from './tabs__initTabs';
export type _p_initTabs = Parameters<typeof initTabs>;
export type _r_initTabs = ReturnType<typeof initTabs>;
