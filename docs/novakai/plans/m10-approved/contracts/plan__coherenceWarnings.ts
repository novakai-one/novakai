import type { CoherenceWarning, Plan, Verdict } from './__types.generated';

// @novakai-node plan__coherenceWarnings kind=function
/** find incoherent verdicts: a change accepted while a dependency is rejected */
export function coherenceWarnings(_plan: Plan, _verdicts: Record<string, Verdict | undefined>): CoherenceWarning[] {
  throw new Error('unimplemented');
}
