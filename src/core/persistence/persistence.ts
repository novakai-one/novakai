/* =====================================================================
   persistence.ts — autosave + prefs storage
   ---------------------------------------------------------------------
   Responsibility: read/write the model and the camera to localStorage
   (debounced), restore them on boot, and load/save the Prefs object.
   This is the only module that touches the autosave/pref storage keys.
   It mutates ctx.state / ctx.cam / ctx.prefs in place on load.
   ===================================================================== */

import type { AppContext } from '../context/context';
import type { Prefs } from '../types/types';
import { LS_KEY, PREF_KEY, DEFAULT_PREFS } from '../config/config';
import { normalizeFrontmatter } from '../frontmatter/frontmatter';

export interface PersistenceApi {
  persist: () => void;
  loadPersisted: () => boolean;
}

export function initPersistence(ctx: AppContext): PersistenceApi {
  const { state, cam } = ctx;
  let persistTimer: number | null = null;

  function persist(): void {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({
          nodes: state.nodes, edges: state.edges, nid: state.nid, eid: state.eid, dir: state.dir, hier: state.hier, cam,
        }));
      } catch { /* storage may be unavailable; ignore */ }
    }, 400);
  }

  function loadPersisted(): boolean {
    try {
      const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem('flowmap.autosave.v1'); // ponytail: legacy-key fallback (pre-novakai rename); drop once users have re-saved
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s.nodes || !Object.keys(s.nodes).length) return false;
      state.nodes = s.nodes; state.edges = s.edges;
      state.nid = s.nid || 1; state.eid = s.eid || 1;
      state.dir = s.dir || 'TD';
      state.hier = s.hier ?? { groups: {}, memberOf: {} };
      // migrate any frontmatter saved before the interfaces refactor
      for (const n of Object.values(state.nodes)) {
        if (n.fm) n.fm = normalizeFrontmatter(n.fm);
      }
      if (s.cam) { cam.x = s.cam.x; cam.y = s.cam.y; cam.z = s.cam.z; }
      return true;
    } catch { return false; }
  }

  return { persist, loadPersisted };
}

/** Load persisted prefs over the supplied defaults (mutates `prefs`). */
export function loadPrefs(prefs: Prefs): void {
  try {
    const raw = localStorage.getItem(PREF_KEY) ?? localStorage.getItem('flowmap.prefs.v1'); // ponytail: legacy-key fallback
    if (raw) Object.assign(prefs, JSON.parse(raw));
    // migrate the legacy 260px frontmatter-card default (too narrow; wrapped
    // type names) up to the current default — nobody picked 260 on purpose
    if (prefs.fmWidth === 260) prefs.fmWidth = DEFAULT_PREFS.fmWidth;
  } catch { /* ignore */ }
}

/** Persist prefs. */
export function savePrefs(prefs: Prefs): void {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
