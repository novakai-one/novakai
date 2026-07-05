// @flowmap-contract clipboard__duplicateSel kind=function
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
// TODO(Idea A): add executable behavioral assertions under a test runner.
import { duplicateSel } from './clipboard__duplicateSel';
export type _p_duplicateSel = Parameters<typeof duplicateSel>;
export type _r_duplicateSel = ReturnType<typeof duplicateSel>;
