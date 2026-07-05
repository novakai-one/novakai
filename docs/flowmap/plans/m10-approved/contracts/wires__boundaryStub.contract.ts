// @flowmap-contract wires__boundaryStub kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { boundaryStub } from './wires__boundaryStub';
export type _p_boundaryStub = Parameters<typeof boundaryStub>;
export type _r_boundaryStub = ReturnType<typeof boundaryStub>;
