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

export function initInspectorFrontmatter(ctx: AppContext) {
  /** Ensure the node has a frontmatter object to edit, return it. */
  function ensureFm(n: DiagramNode): Frontmatter {
    if (!n.fm) n.fm = emptyFrontmatter();
    return n.fm;
  }

  /** After any edit: drop the fm entirely if the user blanked everything. */
  function cleanupIfEmpty(n: DiagramNode): void {
    if (n.fm && isFrontmatterEmpty(n.fm)) n.fm = undefined;
  }

  /** A node-level state list (rows keyed only by item index). */
  function stateRowsHtml(items: string[]): string {
    return items.map((val, i) => `
      <div class="fm-listrow">
        <input class="fm-input" data-fmstate data-i="${i}" list="fmTypes" value="${esc(val)}" placeholder="${PLACEHOLDER.state}">
        <button class="fm-x" data-fmstatedel data-i="${i}" title="Remove">×</button>
      </div>`).join('');
  }

  /** One accepts/returns row inside interface `ifIdx`. */
  function ifaceListRowsHtml(ifIdx: number, key: IfaceKey, items: string[]): string {
    return items.map((val, i) => `
      <div class="fm-listrow">
        <input class="fm-input" data-iflist="${key}" data-if="${ifIdx}" data-i="${i}" list="fmTypes" value="${esc(val)}" placeholder="${PLACEHOLDER[key]}">
        <button class="fm-x" data-ifdel="${key}" data-if="${ifIdx}" data-i="${i}" title="Remove">×</button>
      </div>`).join('');
  }

  /** One interface block: name + accepts list + returns list + remove. */
  function ifaceBlockHtml(ifIdx: number, iface: { name: string; accepts: string[]; returns: string[] }): string {
    return `
      <div class="fm-iface" data-ifblock="${ifIdx}">
        <div class="fm-listhead fm-iface-head">
          <input class="fm-input fm-iface-name" data-ifname data-if="${ifIdx}" value="${esc(iface.name)}" placeholder="interface ${ifIdx + 1}">
          <button class="fm-x" data-deliface data-if="${ifIdx}" title="Remove interface">×</button>
        </div>
        ${IFACE_LISTS.map((key) => `
          <div class="fm-listgroup">
            <div class="fm-listhead"><label>${key}</label><button class="fm-add" data-ifadd="${key}" data-if="${ifIdx}">+ add</button></div>
            <div class="fm-list" data-iflistwrap="${key}" data-if="${ifIdx}">${ifaceListRowsHtml(ifIdx, key, iface[key])}</div>
          </div>`).join('')}
      </div>`;
  }

  /**
   * Render the whole frontmatter section into `host`. Re-rendered wholesale
   * only when list items / interfaces are added or removed; plain text edits
   * write to the model without re-render so focus is preserved (same as the
   * label field).
   */
  function render(host: HTMLElement, n: DiagramNode): void {
    const fm = n.fm;
    const present = fm && !isFrontmatterEmpty(fm);
    const interfaces = fm?.interfaces ?? [];
    const typeOptions = allTypeNames(ctx.state.nodes).map((t) => `<option value="${esc(t)}">`).join('');

    host.innerHTML = `
      <div class="insp-sec-title fm-sec-title">
        <span>Frontmatter</span>
        <span class="fm-hint">public interface</span>
      </div>
      <div class="field"><label>name</label><input id="fmName" class="fm-input" list="fmTypes" value="${esc(fm?.name ?? '')}" placeholder="${esc(n.label)}"></div>
      <div class="field"><label>description</label><textarea id="fmDesc" class="fm-input fm-area" rows="2" placeholder="what this does">${esc(fm?.description ?? '')}</textarea></div>
      <div class="fm-listgroup">
        <div class="fm-listhead"><label>state</label><button class="fm-add" data-fmstateadd>+ add</button></div>
        <div class="fm-list" data-fmstatewrap>${stateRowsHtml(fm?.state ?? [])}</div>
      </div>
      <div class="fm-ifaces">
        <div class="fm-listhead fm-ifaces-head"><label>interfaces</label><button class="fm-add" data-addiface>+ add interface</button></div>
        ${interfaces.map((iface, i) => ifaceBlockHtml(i, iface)).join('')}
      </div>
      ${present ? '<button class="filebtn fm-clear" id="fmClear">Clear frontmatter</button>' : ''}
      <datalist id="fmTypes">${typeOptions}</datalist>
    `;

    wire(host, n);
  }

  function wire(host: HTMLElement, n: DiagramNode): void {
    const reRender = (): void => render(host, n);
    const live = (): void => { ctx.hooks.render(); ctx.hooks.sync(); };
    const commit = (): void => { cleanupIfEmpty(n); ctx.hooks.pushHistory(); };

    // name
    const name = host.querySelector('#fmName') as HTMLInputElement;
    name.oninput = () => { ensureFm(n).name = name.value; live(); };
    name.onchange = commit;

    // description
    const desc = host.querySelector('#fmDesc') as HTMLTextAreaElement;
    desc.oninput = () => { ensureFm(n).description = desc.value; live(); };
    desc.onchange = commit;

    // node-level state: edits
    host.querySelectorAll('input[data-fmstate]').forEach((elRaw) => {
      const el = elRaw as HTMLInputElement;
      const i = +(el.dataset.i as string);
      el.oninput = () => { ensureFm(n).state[i] = el.value; live(); };
      el.onchange = commit;
    });
    // node-level state: add
    (host.querySelector('button[data-fmstateadd]') as HTMLButtonElement | null)?.addEventListener('click', () => {
      ensureFm(n).state.push('');
      reRender();
      const inputs = host.querySelector('[data-fmstatewrap]')?.querySelectorAll('input');
      (inputs?.[inputs.length - 1] as HTMLInputElement | undefined)?.focus();
      live();
    });
    // node-level state: remove
    host.querySelectorAll('button[data-fmstatedel]').forEach((btnRaw) => {
      const btn = btnRaw as HTMLButtonElement;
      btn.onclick = () => {
        const i = +(btn.dataset.i as string);
        n.fm?.state.splice(i, 1);
        cleanupIfEmpty(n);
        reRender();
        live(); ctx.hooks.pushHistory();
      };
    });

    // add an interface
    (host.querySelector('button[data-addiface]') as HTMLButtonElement | null)?.addEventListener('click', () => {
      ensureFm(n).interfaces.push(emptyInterface());
      reRender();
      // focus the new interface's name field
      const names = host.querySelectorAll('input[data-ifname]');
      (names[names.length - 1] as HTMLInputElement | undefined)?.focus();
      live();
    });

    // remove an interface
    host.querySelectorAll('button[data-deliface]').forEach((btnRaw) => {
      const btn = btnRaw as HTMLButtonElement;
      btn.onclick = () => {
        const ifIdx = +(btn.dataset.if as string);
        n.fm?.interfaces.splice(ifIdx, 1);
        cleanupIfEmpty(n);
        reRender();
        live(); ctx.hooks.pushHistory();
      };
    });

    // interface name edits
    host.querySelectorAll('input[data-ifname]').forEach((elRaw) => {
      const el = elRaw as HTMLInputElement;
      const ifIdx = +(el.dataset.if as string);
      el.oninput = () => { ensureFm(n).interfaces[ifIdx].name = el.value; live(); };
      el.onchange = commit;
    });

    // interface accepts/returns edits
    host.querySelectorAll('input[data-iflist]').forEach((elRaw) => {
      const el = elRaw as HTMLInputElement;
      const key = el.dataset.iflist as IfaceKey;
      const ifIdx = +(el.dataset.if as string);
      const i = +(el.dataset.i as string);
      el.oninput = () => { ensureFm(n).interfaces[ifIdx][key][i] = el.value; live(); };
      el.onchange = commit;
    });

    // add to an interface's accepts/returns
    host.querySelectorAll('button[data-ifadd]').forEach((btnRaw) => {
      const btn = btnRaw as HTMLButtonElement;
      btn.onclick = () => {
        const key = btn.dataset.ifadd as IfaceKey;
        const ifIdx = +(btn.dataset.if as string);
        ensureFm(n).interfaces[ifIdx][key].push('');
        reRender();
        const wrap = host.querySelector(`[data-iflistwrap="${key}"][data-if="${ifIdx}"]`);
        const inputs = wrap?.querySelectorAll('input');
        (inputs?.[inputs.length - 1] as HTMLInputElement | undefined)?.focus();
        live();
      };
    });

    // remove from an interface's accepts/returns
    host.querySelectorAll('button[data-ifdel]').forEach((btnRaw) => {
      const btn = btnRaw as HTMLButtonElement;
      btn.onclick = () => {
        const key = btn.dataset.ifdel as IfaceKey;
        const ifIdx = +(btn.dataset.if as string);
        const i = +(btn.dataset.i as string);
        n.fm?.interfaces[ifIdx]?.[key].splice(i, 1);
        cleanupIfEmpty(n);
        reRender();
        live(); ctx.hooks.pushHistory();
      };
    });

    // clear all frontmatter
    const clear = host.querySelector('#fmClear') as HTMLButtonElement | null;
    if (clear) {
      clear.onclick = () => {
        n.fm = undefined;
        reRender();
        live(); ctx.hooks.pushHistory();
      };
    }
  }

  return { renderFrontmatterSection: render };
}
