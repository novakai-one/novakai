// @flowmap-contract navigator__navigateTo kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { navigateTo } from './navigator__navigateTo';
export type _p_navigateTo = Parameters<typeof navigateTo>;
export type _r_navigateTo = ReturnType<typeof navigateTo>;
