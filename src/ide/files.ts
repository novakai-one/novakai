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

function createPageElement(): HTMLDivElement {
  const page = document.createElement('div');
  page.className = 'design-page files-page';
  return page;
}

function createFormElement(): { form: HTMLFormElement; input: HTMLInputElement } {
  const form = document.createElement('form');
  form.className = 'design-outcome-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'design-outcome-input';
  input.placeholder = 'draft-name';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'design-outcome-submit';
  save.textContent = 'Save design';
  form.append(input, save);
  return { form, input };
}

function createListElement(): HTMLDivElement {
  const list = document.createElement('div');
  list.className = 'design-list';
  return list;
}

async function loadDesignNames(ctx: AppContext): Promise<string[]> {
  // guard the hook: a direct load at #files can render before main.ts finishes
  // wiring ctx.hooks (throwing placeholder) — degrade to the empty state, never throw.
  try {
    return await ctx.hooks.listDesigns();
  } catch {
    return [];
  }
}

function renderEmptyState(list: HTMLDivElement): void {
  const def = EMPTY.find((row) => row.id === TAB_ID);
  if (!def) throw new Error(`pages.ts EMPTY is missing the '${TAB_ID}' row`);
  list.appendChild(emptyPage(def));
}

function renderDesignButtons(list: HTMLDivElement, names: string[], ctx: AppContext): void {
  for (const name of names) {
    const row = createDesignButton(name);
    row.onclick = () => {
      void ctx.hooks.loadDesign(name);
    };
    list.appendChild(row);
  }
}

function createDesignButton(name: string): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'design-btn';
  row.textContent = name;
  return row;
}

function createListRefresh(
  list: HTMLDivElement,
  ctx: AppContext
): () => Promise<void> {
  return async function refresh(): Promise<void> {
    list.innerHTML = '';
    const names = await loadDesignNames(ctx);
    if (names.length === 0) {
      renderEmptyState(list);
    } else {
      renderDesignButtons(list, names, ctx);
    }
  };
}

function setupFormSubmit(
  form: HTMLFormElement,
  input: HTMLInputElement,
  refresh: () => Promise<void>,
  ctx: AppContext
): void {
  form.onsubmit = (evt) => {
    evt.preventDefault();
    const name = input.value.trim();
    if (name) {
      void ctx.hooks.saveDesign(name).then(refresh);
    }
  };
}

function createRender(ctx: AppContext): () => HTMLElement {
  return function render(): HTMLElement {
    const page = createPageElement();
    const { form, input } = createFormElement();
    const list = createListElement();
    const refresh = createListRefresh(list, ctx);

    setupFormSubmit(form, input, refresh, ctx);
    page.append(form, list);
    // defer the first fill so boot-at-#files runs it AFTER main.ts wires ctx.hooks.
    queueMicrotask(() => void refresh());
    return page;
  };
}

export function initFilesPage(ctx: AppContext): FilesPageApi {
  return { render: createRender(ctx) };
}
