/* =====================================================================
   files.ts — K7 Files tab stub (K-seam pre-wiring)
   ---------------------------------------------------------------------
   Responsibility: initFilesPage(ctx) follows the house initX(ctx) shape
   so K7 can grow this into the real open/create/edit-real-files +
   repo-switch surface without touching main.ts / shell.ts / pages.ts
   again (SPEC_SHELL "K4-K10 page modules land under src/ide/**" —
   named initFilesPage there, not initFiles, since io/files.ts already
   owns that name for the app's own save/load-.mmd module). For now it
   delegates entirely to pages.ts's EMPTY row + emptyPage() — the exact
   same designed empty state the shell rendered directly before this
   seam PR — so behaviour is byte-identical; nothing is duplicated, only
   re-owned per tab.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { EMPTY, emptyPage } from './pages';

export interface FilesPageApi {
  render(): HTMLElement;
}

/** Cross-tab repo-scope seam. K7's spec (once written) defines the real
    semantics — which repo is loaded from disk and how every other tab
    reads it. This is a type-only placeholder so other lanes may
    type-import it ahead of K7 landing, without a shared-file edit later. */
export interface RepoScope {
  rootLabel: string;
}

const TAB_ID = 'files';

export function initFilesPage(ctx: AppContext): FilesPageApi {
  void ctx; // no state at this stub stage — kept for the house initX(ctx) shape K7 will fill in
  function render(): HTMLElement {
    const def = EMPTY.find((row) => row.id === TAB_ID);
    if (!def) throw new Error(`pages.ts EMPTY is missing the '${TAB_ID}' row`);
    return emptyPage(def);
  }
  return { render };
}
