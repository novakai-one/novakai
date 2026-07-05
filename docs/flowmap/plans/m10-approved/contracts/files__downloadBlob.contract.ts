// @flowmap-contract files__downloadBlob kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { downloadBlob } from './files__downloadBlob';
export type _p_downloadBlob = Parameters<typeof downloadBlob>;
export type _r_downloadBlob = ReturnType<typeof downloadBlob>;
