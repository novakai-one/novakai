/* diff-views/split.ts — git-style two-column line diff (View 2).
   Computes an LCS line alignment between before/after text so unchanged
   lines sit side-by-side and add/remove lines are marked in the gutter. */
import { type ViewArg, el } from './types';

type Op = { tag: 'eq' | 'add' | 'rem'; left?: string; right?: string };

/** Myers-lite via LCS table on line arrays. Fine for diagram-sized text. */
function buildLcsTable(before: string[], after: string[]): number[][] {
  const lcs: number[][] = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
  for (let row = before.length - 1; row >= 0; row--) {
    for (let col = after.length - 1; col >= 0; col--) {
      lcs[row][col] = before[row] === after[col]
        ? lcs[row + 1][col + 1] + 1
        : Math.max(lcs[row + 1][col], lcs[row][col + 1]);
    }
  }
  return lcs;
}

/** Advance one step of the LCS walk, mutating pos and returning the op it emits. */
function advance(before: string[], after: string[], lcs: number[][], pos: { row: number; col: number }): Op {
  const { row, col } = pos;
  if (before[row] === after[col]) {
    pos.row++;
    pos.col++;
    return { tag: 'eq', left: before[row], right: after[col] };
  }
  if (lcs[row + 1][col] >= lcs[row][col + 1]) {
    pos.row++;
    return { tag: 'rem', left: before[row] };
  }
  pos.col++;
  return { tag: 'add', right: after[col] };
}

function lineDiff(before: string[], after: string[]): Op[] {
  const lcs = buildLcsTable(before, after);
  const ops: Op[] = [];
  const pos = { row: 0, col: 0 };
  while (pos.row < before.length && pos.col < after.length) {
    ops.push(advance(before, after, lcs, pos));
  }
  while (pos.row < before.length) ops.push({ tag: 'rem', left: before[pos.row++] });
  while (pos.col < after.length) ops.push({ tag: 'add', right: after[pos.col++] });
  return ops;
}

function appendOpRow(colL: HTMLElement, colR: HTMLElement, entry: Op): void {
  if (entry.tag === 'eq') {
    colL.appendChild(lineRow('', entry.left!, 'eq'));
    colR.appendChild(lineRow('', entry.right!, 'eq'));
  } else if (entry.tag === 'rem') {
    colL.appendChild(lineRow('−', entry.left!, 'rem'));
    colR.appendChild(lineRow('', '', 'pad'));
  } else {
    colL.appendChild(lineRow('', '', 'pad'));
    colR.appendChild(lineRow('+', entry.right!, 'add'));
  }
}

function buildSplitColumn(headText: string): HTMLElement {
  const col = el('div', 'dv-split-col');
  col.appendChild(el('div', 'dv-split-head', headText));
  return col;
}

export function renderSplit(host: HTMLElement, arg: ViewArg): void {
  host.innerHTML = '';
  const before = arg.beforeText.replace(/\s+$/, '').split('\n');
  const after = arg.afterText.replace(/\s+$/, '').split('\n');
  const ops = lineDiff(before, after);

  const wrap = el('div', 'dv-split');
  const colL = buildSplitColumn('before · current');
  const colR = buildSplitColumn('after · proposal');
  ops.forEach((entry) => appendOpRow(colL, colR, entry));
  wrap.appendChild(colL);
  wrap.appendChild(colR);
  host.appendChild(wrap);
}

function lineRow(mark: string, text: string, cls: string): HTMLElement {
  const row = el('div', `dv-line ${cls}`);
  const gutter = el('span', 'dv-gutter', mark);
  const code = el('span', 'dv-code', text);
  row.appendChild(gutter);
  row.appendChild(code);
  return row;
}
