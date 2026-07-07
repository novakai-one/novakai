/* =====================================================================
   rules.ts — K9 Rules tab stub (K-seam pre-wiring)
   ---------------------------------------------------------------------
   Responsibility: initRules(ctx) follows the house initX(ctx) shape so
   K9 can grow this into the real render+edit surface for the ruleset
   the contract gates consume, without touching main.ts / shell.ts /
   pages.ts again (SPEC_SHELL "K4-K10 page modules land under
   src/ide/**"). For now it delegates entirely to pages.ts's EMPTY row +
   emptyPage() — the exact same designed empty state the shell rendered
   directly before this seam PR — so behaviour is byte-identical;
   nothing is duplicated, only re-owned per tab.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { EMPTY, emptyPage } from './pages';

export interface RulesApi {
  render(): HTMLElement;
}

const TAB_ID = 'rules';

export function initRules(ctx: AppContext): RulesApi {
  void ctx; // no state at this stub stage — kept for the house initX(ctx) shape K9 will fill in
  function render(): HTMLElement {
    const def = EMPTY.find((row) => row.id === TAB_ID);
    if (!def) throw new Error(`pages.ts EMPTY is missing the '${TAB_ID}' row`);
    return emptyPage(def);
  }
  return { render };
}
