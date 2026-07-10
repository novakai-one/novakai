/* =====================================================================
   inspector-frontmatter.ts — the frontmatter editor in the side panel
   ---------------------------------------------------------------------
   Responsibility: render + wire the frontmatter editing UI for a single
   selected node inside the Inspector. Provides node-level name +
   description single fields, a node-level repeatable `state` list, and a
   list of public interfaces. Each interface has its own name plus
   repeatable accepts / returns lists. Writes straight into node.fm and
   triggers render+sync (and history on commit), mirroring how the label
   field behaves.

   Kept as its own module so the frontmatter UI can evolve without
   touching the rest of the inspector. The host inspector calls
   renderFrontmatterSection(host, node) and this module owns everything
   inside that host element.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import type { DiagramNode, Frontmatter } from '../../core/types/types';
import { esc } from '../../core/config/config';
import { emptyFrontmatter, emptyInterface, isFrontmatterEmpty, allTypeNames } from '../../core/frontmatter/frontmatter';

/** repeatable accepts/returns lists live inside an interface */
type IfaceKey = 'accepts' | 'returns';
const IFACE_LISTS: IfaceKey[] = ['accepts', 'returns'];

const PLACEHOLDER: Record<IfaceKey | 'state', string> = {
  state: 'count: number',
  accepts: 'key: string',
  returns: 'Snapshot',
};

/** the host + node a wiring helper acts on — bundled to stay at/under the 4-param limit */
interface FmTarget { host: HTMLElement; node: DiagramNode }
/** the anchor delegates (ensureFm/cleanupIfEmpty), passed down so module-scope wiring
    helpers go through the same "ensure/cleanup" path the anchors themselves expose. */
interface FmDeps { ensureFm: (n: DiagramNode) => Frontmatter; cleanupIfEmpty: (n: DiagramNode) => void }

/* ---------- model helpers (shared by the anchor delegates + the wiring below) ---------- */

function getOrCreateFm(node: DiagramNode): Frontmatter {
  if (!node.fm) node['fm'] = emptyFrontmatter();
  return node.fm as Frontmatter;
}

function clearFmIfEmpty(node: DiagramNode): void {
  if (node.fm && isFrontmatterEmpty(node.fm)) node['fm'] = undefined;
}

function liveUpdate(ctx: AppContext): void {
  ctx.hooks.render();
  ctx.hooks.sync();
}

function commitFmEdit(ctx: AppContext, node: DiagramNode, cleanupIfEmpty: (n: DiagramNode) => void): void {
  cleanupIfEmpty(node);
  ctx.hooks.pushHistory();
}

function focusLast(list: NodeListOf<Element> | null | undefined): void {
  (list?.[list.length - 1] as HTMLInputElement | undefined)?.focus();
}

/* ---------- markup ---------- */

/** One node-level state row. */
function stateRowHtml(val: string, i: number): string {
  return `
    <div class="fm-listrow">
      <input class="fm-input" data-fmstate data-i="${i}" list="fmTypes"
        value="${esc(val)}" placeholder="${PLACEHOLDER.state}">
      <button class="fm-x" data-fmstatedel data-i="${i}" title="Remove">×</button>
    </div>`;
}

/** One accepts/returns row inside interface `ifIdx`. */
function ifaceListRowHtml(ifIdx: number, key: IfaceKey, val: string, i: number): string {
  return `
    <div class="fm-listrow">
      <input class="fm-input" data-iflist="${key}" data-if="${ifIdx}" data-i="${i}"
        list="fmTypes" value="${esc(val)}" placeholder="${PLACEHOLDER[key]}">
      <button class="fm-x" data-ifdel="${key}" data-if="${ifIdx}" data-i="${i}" title="Remove">×</button>
    </div>`;
}

/** One accepts/returns list group (label + add button + rows) inside interface `ifIdx`. */
function ifaceListGroupHtml(
  ifIdx: number, key: IfaceKey, items: string[], ifaceListRowsHtml: (i: number, k: IfaceKey, it: string[]) => string,
): string {
  const rows = ifaceListRowsHtml(ifIdx, key, items);
  return `
    <div class="fm-listgroup">
      <div class="fm-listhead"><label>${key}</label>
        <button class="fm-add" data-ifadd="${key}" data-if="${ifIdx}">+ add</button></div>
      <div class="fm-list" data-iflistwrap="${key}" data-if="${ifIdx}">${rows}</div>
    </div>`;
}

/** One interface block: name + accepts list + returns list + remove. */
function buildIfaceBlockHtml(
  ifIdx: number, iface: { name: string; accepts: string[]; returns: string[] },
  ifaceListRowsHtml: (i: number, k: IfaceKey, it: string[]) => string,
): string {
  const lists = IFACE_LISTS.map((key) => ifaceListGroupHtml(ifIdx, key, iface[key], ifaceListRowsHtml)).join('');
  return `
    <div class="fm-iface" data-ifblock="${ifIdx}">
      <div class="fm-listhead fm-iface-head">
        <input class="fm-input fm-iface-name" data-ifname data-if="${ifIdx}"
          value="${esc(iface.name)}" placeholder="interface ${ifIdx + 1}">
        <button class="fm-x" data-deliface data-if="${ifIdx}" title="Remove interface">×</button>
      </div>
      ${lists}
    </div>`;
}

/** name + description fields at the top of the frontmatter section. */
function fmHeaderFieldsHtml(node: DiagramNode, fmVal: Frontmatter | undefined): string {
  return `
    <div class="field"><label>name</label>
      <input id="fmName" class="fm-input" list="fmTypes"
        value="${esc(fmVal?.name ?? '')}" placeholder="${esc(node.label)}"></div>
    <div class="field"><label>description</label>
      <textarea id="fmDesc" class="fm-input fm-area" rows="2"
        placeholder="what this does">${esc(fmVal?.description ?? '')}</textarea></div>`;
}

function typeOptionsHtml(ctx: AppContext): string {
  return allTypeNames(ctx.state.nodes).map((typeName) => `<option value="${esc(typeName)}">`).join('');
}

const FM_TITLE_HTML = `
    <div class="insp-sec-title fm-sec-title">
      <span>Frontmatter</span>
      <span class="fm-hint">public interface</span>
    </div>`;

function fmStateSectionHtml(stateRows: string): string {
  return `
    <div class="fm-listgroup">
      <div class="fm-listhead"><label>state</label><button class="fm-add" data-fmstateadd>+ add</button></div>
      <div class="fm-list" data-fmstatewrap>${stateRows}</div>
    </div>`;
}

function fmIfacesSectionHtml(ifaceBlocks: string): string {
  return `
    <div class="fm-ifaces">
      <div class="fm-listhead fm-ifaces-head"><label>interfaces</label>
        <button class="fm-add" data-addiface>+ add interface</button></div>
      ${ifaceBlocks}
    </div>`;
}

/** Whole frontmatter section markup for `node`, built with `ctx` for the type datalist. */
function buildFmSectionHtml(
  ctx: AppContext, node: DiagramNode,
  stateRowsHtml: (items: string[]) => string,
  ifaceBlockHtml: (ifIdx: number, iface: { name: string; accepts: string[]; returns: string[] }) => string,
): string {
  const fmVal = node.fm;
  const present = fmVal && !isFrontmatterEmpty(fmVal);
  const interfaces = fmVal?.interfaces ?? [];
  const stateSec = fmStateSectionHtml(stateRowsHtml(fmVal?.state ?? []));
  const ifacesSec = fmIfacesSectionHtml(interfaces.map((iface, i) => ifaceBlockHtml(i, iface)).join(''));
  const clearBtn = present ? '<button class="filebtn fm-clear" id="fmClear">Clear frontmatter</button>' : '';

  return `
    ${FM_TITLE_HTML}
    ${fmHeaderFieldsHtml(node, fmVal)}
    ${stateSec}
    ${ifacesSec}
    ${clearBtn}
    <datalist id="fmTypes">${typeOptionsHtml(ctx)}</datalist>
  `;
}

/* ---------- wiring ---------- */

function wireNameField(ctx: AppContext, target: FmTarget, deps: FmDeps): void {
  const nameInput = target.host.querySelector('#fmName') as HTMLInputElement;
  nameInput.oninput = () => {
    deps.ensureFm(target.node).name = nameInput.value;
    liveUpdate(ctx);
  };
  nameInput.onchange = () => commitFmEdit(ctx, target.node, deps.cleanupIfEmpty);
}

function wireDescField(ctx: AppContext, target: FmTarget, deps: FmDeps): void {
  const descInput = target.host.querySelector('#fmDesc') as HTMLTextAreaElement;
  descInput.oninput = () => {
    deps.ensureFm(target.node).description = descInput.value;
    liveUpdate(ctx);
  };
  descInput.onchange = () => commitFmEdit(ctx, target.node, deps.cleanupIfEmpty);
}

function wireStateRows(ctx: AppContext, target: FmTarget, deps: FmDeps): void {
  target.host.querySelectorAll('input[data-fmstate]').forEach((elRaw) => {
    const input = elRaw as HTMLInputElement;
    const i = +(input.dataset.i as string);
    input.oninput = () => {
      deps.ensureFm(target.node).state[i] = input.value;
      liveUpdate(ctx);
    };
    input.onchange = () => commitFmEdit(ctx, target.node, deps.cleanupIfEmpty);
  });
}

function wireStateAdd(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  const btn = target.host.querySelector('button[data-fmstateadd]') as HTMLButtonElement | null;
  btn?.addEventListener('click', () => {
    deps.ensureFm(target.node).state.push('');
    reRender();
    focusLast(target.host.querySelector('[data-fmstatewrap]')?.querySelectorAll('input'));
    liveUpdate(ctx);
  });
}

function wireStateRemove(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  target.host.querySelectorAll('button[data-fmstatedel]').forEach((btnRaw) => {
    const btn = btnRaw as HTMLButtonElement;
    btn.onclick = () => {
      const i = +(btn.dataset.i as string);
      target.node.fm?.state.splice(i, 1);
      deps.cleanupIfEmpty(target.node);
      reRender();
      liveUpdate(ctx);
      ctx.hooks.pushHistory();
    };
  });
}

function wireIfaceAdd(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  const btn = target.host.querySelector('button[data-addiface]') as HTMLButtonElement | null;
  btn?.addEventListener('click', () => {
    deps.ensureFm(target.node).interfaces.push(emptyInterface());
    reRender();
    focusLast(target.host.querySelectorAll('input[data-ifname]'));
    liveUpdate(ctx);
  });
}

function wireIfaceRemove(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  target.host.querySelectorAll('button[data-deliface]').forEach((btnRaw) => {
    const btn = btnRaw as HTMLButtonElement;
    btn.onclick = () => {
      const ifIdx = +(btn.dataset.if as string);
      target.node.fm?.interfaces.splice(ifIdx, 1);
      deps.cleanupIfEmpty(target.node);
      reRender();
      liveUpdate(ctx);
      ctx.hooks.pushHistory();
    };
  });
}

function wireIfaceNameEdits(ctx: AppContext, target: FmTarget, deps: FmDeps): void {
  target.host.querySelectorAll('input[data-ifname]').forEach((elRaw) => {
    const input = elRaw as HTMLInputElement;
    const ifIdx = +(input.dataset.if as string);
    input.oninput = () => {
      deps.ensureFm(target.node).interfaces[ifIdx].name = input.value;
      liveUpdate(ctx);
    };
    input.onchange = () => commitFmEdit(ctx, target.node, deps.cleanupIfEmpty);
  });
}

function wireIfaceListEdits(ctx: AppContext, target: FmTarget, deps: FmDeps): void {
  target.host.querySelectorAll('input[data-iflist]').forEach((elRaw) => {
    const input = elRaw as HTMLInputElement;
    const key = input.dataset.iflist as IfaceKey;
    const ifIdx = +(input.dataset.if as string);
    const i = +(input.dataset.i as string);
    input.oninput = () => {
      deps.ensureFm(target.node).interfaces[ifIdx][key][i] = input.value;
      liveUpdate(ctx);
    };
    input.onchange = () => commitFmEdit(ctx, target.node, deps.cleanupIfEmpty);
  });
}

function wireIfaceListAdd(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  target.host.querySelectorAll('button[data-ifadd]').forEach((btnRaw) => {
    const btn = btnRaw as HTMLButtonElement;
    btn.onclick = () => {
      const key = btn.dataset.ifadd as IfaceKey;
      const ifIdx = +(btn.dataset.if as string);
      deps.ensureFm(target.node).interfaces[ifIdx][key].push('');
      reRender();
      focusLast(target.host.querySelector(`[data-iflistwrap="${key}"][data-if="${ifIdx}"]`)?.querySelectorAll('input'));
      liveUpdate(ctx);
    };
  });
}

function wireIfaceListRemove(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  target.host.querySelectorAll('button[data-ifdel]').forEach((btnRaw) => {
    const btn = btnRaw as HTMLButtonElement;
    btn.onclick = () => {
      const key = btn.dataset.ifdel as IfaceKey;
      const ifIdx = +(btn.dataset.if as string);
      const i = +(btn.dataset.i as string);
      target.node.fm?.interfaces[ifIdx]?.[key].splice(i, 1);
      deps.cleanupIfEmpty(target.node);
      reRender();
      liveUpdate(ctx);
      ctx.hooks.pushHistory();
    };
  });
}

function wireClearButton(ctx: AppContext, target: FmTarget, reRender: () => void): void {
  const clearBtn = target.host.querySelector('#fmClear') as HTMLButtonElement | null;
  if (!clearBtn) return;
  clearBtn.onclick = () => {
    target.node['fm'] = undefined;
    reRender();
    liveUpdate(ctx);
    ctx.hooks.pushHistory();
  };
}

/** the two single-field sections (name/description) — grouped so `wire` stays under
    the statement budget. */
function wireFieldEdits(ctx: AppContext, target: FmTarget, deps: FmDeps): void {
  wireNameField(ctx, target, deps);
  wireDescField(ctx, target, deps);
}

/** the node-level `state` list: edit / add / remove. */
function wireStateSection(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  wireStateRows(ctx, target, deps);
  wireStateAdd(ctx, target, reRender, deps);
  wireStateRemove(ctx, target, reRender, deps);
}

/** the interfaces list: add / remove interfaces, edit names, and each interface's
    accepts/returns lists. */
function wireIfaceSection(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  wireIfaceAdd(ctx, target, reRender, deps);
  wireIfaceRemove(ctx, target, reRender, deps);
  wireIfaceNameEdits(ctx, target, deps);
  wireIfaceListEdits(ctx, target, deps);
  wireIfaceListAdd(ctx, target, reRender, deps);
  wireIfaceListRemove(ctx, target, reRender, deps);
}

/** every wiring section in one call, so the frozen `wire` delegate stays a thin call site. */
function wireAll(ctx: AppContext, target: FmTarget, reRender: () => void, deps: FmDeps): void {
  wireFieldEdits(ctx, target, deps);
  wireStateSection(ctx, target, reRender, deps);
  wireIfaceSection(ctx, target, reRender, deps);
  wireClearButton(ctx, target, reRender);
}

export function initInspectorFrontmatter(ctx: AppContext) {
  function ensureFm(node: DiagramNode): Frontmatter {
    return getOrCreateFm(node); }
  function cleanupIfEmpty(node: DiagramNode): void {
    clearFmIfEmpty(node); }
  function stateRowsHtml(items: string[]): string {
    return items.map(stateRowHtml).join(''); }
  function ifaceListRowsHtml(ifIdx: number, key: IfaceKey, items: string[]): string {
    return items.map((val, i) => ifaceListRowHtml(ifIdx, key, val, i)).join(''); }
  function ifaceBlockHtml(ifIdx: number, iface: { name: string; accepts: string[]; returns: string[] }): string {
    return buildIfaceBlockHtml(ifIdx, iface, ifaceListRowsHtml); }
  function render(host: HTMLElement, node: DiagramNode): void {
    host.innerHTML = buildFmSectionHtml(ctx, node, stateRowsHtml, ifaceBlockHtml);
    wire(host, node); }
  function wire(host: HTMLElement, node: DiagramNode): void {
    const reRender = (): void => render(host, node);
    const target: FmTarget = { host, node }, deps: FmDeps = { ensureFm, cleanupIfEmpty };
    wireAll(ctx, target, reRender, deps); }

  return { renderFrontmatterSection: render };
}
