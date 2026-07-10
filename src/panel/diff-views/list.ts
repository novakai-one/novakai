/* diff-views/list.ts — grouped, expandable change list (View 1). */
import { type ViewArg, type DiffModel, el, splitEdgeKey } from './types';

type ChangedNode = ViewArg['diff']['changedNodes'][number];

function isEmptyDiff(diff: ViewArg['diff']): boolean {
  return diff.counts.nAdd + diff.counts.nRem + diff.counts.nChg + diff.counts.eAdd + diff.counts.eRem === 0;
}

function toggleSection(head: HTMLElement, bodyEl: HTMLElement): void {
  const open = bodyEl.style.display !== 'none';
  bodyEl.style.display = open ? 'none' : 'block';
  (head.querySelector('.dv-caret') as HTMLElement).textContent = open ? '▸' : '▾';
}

interface SectionSpec { title: string; cls: string; count: number; }

function renderSection(root: HTMLElement, spec: SectionSpec, rows: HTMLElement[]): void {
  if (!spec.count) return;
  const sec = el('div', 'dv-sec');
  const head = el('button', 'dv-sec-head');
  head.innerHTML = `<span class="dv-caret">▾</span><span class="dv-sec-title ${spec.cls}">${spec.title}</span>`
    + `<span class="dv-sec-n">${spec.count}</span>`;
  const bodyEl = el('div', 'dv-sec-body');
  rows.forEach((row) => bodyEl.appendChild(row));
  head.onclick = () => toggleSection(head, bodyEl);
  sec.appendChild(head);
  sec.appendChild(bodyEl);
  root.appendChild(sec);
}

function addedNodeRows(ids: string[], after: DiffModel): HTMLElement[] {
  return ids.map((id) => {
    const node = after.nodes[id];
    return el('div', 'dv-row add', `+ ${id}  ·  ${node?.kind ?? node?.shape ?? ''}`);
  });
}

function removedNodeRows(ids: string[], before: DiffModel): HTMLElement[] {
  return ids.map((id) => {
    const node = before.nodes[id];
    return el('div', 'dv-row rem', `− ${id}  ·  ${node?.kind ?? node?.shape ?? ''}`);
  });
}

function changedFieldRow(chg: ChangedNode): HTMLElement {
  const field = el('div', 'dv-field');
  field.innerHTML = `<span class="dv-field-name">${chg.field}</span>`
    + `<div class="dv-before">− ${escapeHtml(chg.before) || '<em>empty</em>'}</div>`
    + `<div class="dv-after">+ ${escapeHtml(chg.after) || '<em>empty</em>'}</div>`;
  return field;
}

function changedNodeRow(id: string, changes: ChangedNode[]): HTMLElement {
  const row = el('div', 'dv-row-block');
  row.appendChild(el('div', 'dv-row chg', `~ ${id}`));
  changes.forEach((chg) => row.appendChild(changedFieldRow(chg)));
  return row;
}

function changedNodeRows(changes: ChangedNode[]): HTMLElement[] {
  const byId = new Map<string, ChangedNode[]>();
  changes.forEach((chg) => {
    if (!byId.has(chg.id)) byId.set(chg.id, []);
    byId.get(chg.id)!.push(chg);
  });
  const rows: HTMLElement[] = [];
  byId.forEach((fieldChanges, id) => rows.push(changedNodeRow(id, fieldChanges)));
  return rows;
}

function edgeChangeRows(added: string[], removed: string[]): HTMLElement[] {
  const rows: HTMLElement[] = [];
  added.forEach((key) => {
    const { from, to: dest, style } = splitEdgeKey(key);
    rows.push(el('div', 'dv-row add', `+ ${from} →|${style}| ${dest}`));
  });
  removed.forEach((key) => {
    const { from, to: dest, style } = splitEdgeKey(key);
    rows.push(el('div', 'dv-row rem', `− ${from} →|${style}| ${dest}`));
  });
  return rows;
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!));
}

export function renderList(host: HTMLElement, arg: ViewArg): void {
  const { diff, before, after } = arg;
  host.innerHTML = '';
  const root = el('div', 'dv-list');
  if (isEmptyDiff(diff)) {
    root.appendChild(el('div', 'diff-empty', 'No changes. Proposal is identical to current.'));
    host.appendChild(root);
    return;
  }
  renderSection(root, { title: 'Added nodes', cls: 'add', count: diff.counts.nAdd },
    addedNodeRows(diff.addedNodes, after));
  renderSection(root, { title: 'Removed nodes', cls: 'rem', count: diff.counts.nRem },
    removedNodeRows(diff.removedNodes, before));
  renderSection(root, { title: 'Changed nodes', cls: 'chg', count: diff.counts.nChg },
    changedNodeRows(diff.changedNodes));
  renderSection(root, { title: 'Edge changes', cls: 'add', count: diff.counts.eAdd + diff.counts.eRem },
    edgeChangeRows(diff.addedEdges, diff.removedEdges));
  host.appendChild(root);
}
