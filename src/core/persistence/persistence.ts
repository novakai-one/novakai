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

// ponytail: legacy-key fallback (pre-novakai rename); drop once users have re-saved
function readPersistedRaw(): string | null {
  return localStorage.getItem(LS_KEY) ?? localStorage.getItem('flowmap.autosave.v1');
}

/** migrate any frontmatter saved before the interfaces refactor */
function migrateFrontmatter(state: AppContext['state']): void {
  for (const node of Object.values(state.nodes)) {
    if (node.fm) node.fm = normalizeFrontmatter(node.fm);
  }
}

function applyCamSnapshot(cam: AppContext['cam'], parsedCam: any): void {
  if (!parsedCam) return;
  cam.x = parsedCam.x;
  cam.y = parsedCam.y;
  cam.z = parsedCam.z;
}

function applyPersistedSnapshot(state: AppContext['state'], cam: AppContext['cam'], parsed: any): boolean {
  if (!parsed.nodes || !Object.keys(parsed.nodes).length) return false;
  state.nodes = parsed.nodes;
  state.edges = parsed.edges;
  state.nid = parsed.nid || 1;
  state.eid = parsed.eid || 1;
  state.dir = parsed.dir || 'TD';
  state.hier = parsed.hier ?? { groups: {}, memberOf: {} };
  migrateFrontmatter(state);
  applyCamSnapshot(cam, parsed.cam);
  return true;
}

function schedulePersist(state: AppContext['state'], cam: AppContext['cam'], timerRef: { id: number | null }): void {
  if (timerRef.id !== null) clearTimeout(timerRef.id);
  timerRef.id = window.setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        nodes: state.nodes, edges: state.edges, nid: state.nid, eid: state.eid, dir: state.dir, hier: state.hier, cam,
      }));
    } catch { /* storage may be unavailable; ignore */ }
  }, 400);
}

function loadPersistedSnapshot(state: AppContext['state'], cam: AppContext['cam']): boolean {
  try {
    const raw = readPersistedRaw();
    if (!raw) return false;
    return applyPersistedSnapshot(state, cam, JSON.parse(raw));
  } catch { return false; }
}

export function initPersistence(ctx: AppContext): PersistenceApi {
  const { state, cam } = ctx;
  const timerRef: { id: number | null } = { id: null };
  return {
    persist: () => schedulePersist(state, cam, timerRef),
    loadPersisted: () => loadPersistedSnapshot(state, cam),
  };
}

/** Load persisted prefs over the supplied defaults (mutates `prefs`). */
export function loadPrefs(prefs: Prefs): void {
  try {
    // ponytail: legacy-key fallback
    const raw = localStorage.getItem(PREF_KEY) ?? localStorage.getItem('flowmap.prefs.v1');
    if (raw) Object.assign(prefs, JSON.parse(raw));
    // migrate the legacy 260px frontmatter-card default (too narrow; wrapped
    // type names) up to the current default — nobody picked 260 on purpose
    if (prefs.fmWidth === 260) prefs.fmWidth = DEFAULT_PREFS.fmWidth;
  } catch { /* ignore */ }
}

/** Persist prefs. */
export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}
