/* diff-views/impact.ts — blast radius (View 3).
   Not a line diff. Ranks every node TOUCHED by the change, by how many
   edges move around it. Answers "what does this reach", for scope review. */
import { type ViewArg, type DiffModel, el, splitEdgeKey } from './types';

interface Hit { id: string; touch: number; reasons: string[]; sev: 'new' | 'gone' | 'chg' | 'edge'; }

function isEmptyDiff(diff: ViewArg['diff']): boolean {
  return diff.counts.nAdd + diff.counts.nRem + diff.counts.nChg + diff.counts.eAdd + diff.counts.eRem === 0;
}

function bumpHit(hits: Map<string, Hit>, id: string, sev: Hit['sev'], reason: string): void {
  let hit = hits.get(id);
  if (!hit) {
    hit = { id, touch: 0, reasons: [], sev };
    hits.set(id, hit);
  }
  hit.touch++;
  if (!hit.reasons.includes(reason)) hit.reasons.push(reason);
  // severity precedence: new/gone win over chg/edge
  if (sev === 'new' || sev === 'gone') hit.sev = sev;
  else if (hit.sev === 'edge' && sev === 'chg') hit.sev = 'chg';
}

function computeHits(diff: ViewArg['diff']): Map<string, Hit> {
  const hits = new Map<string, Hit>();
  diff.addedNodes.forEach((id) => bumpHit(hits, id, 'new', 'new node'));
  diff.removedNodes.forEach((id) => bumpHit(hits, id, 'gone', 'removed node'));
  new Set(diff.changedNodes.map((chg) => chg.id)).forEach((id) => {
    const fields = diff.changedNodes.filter((chg) => chg.id === id).map((chg) => chg.field).join(', ');
    bumpHit(hits, id, 'chg', `changed: ${fields}`);
  });
  diff.addedEdges.forEach((key) => {
    const { from, to: dest } = splitEdgeKey(key);
    bumpHit(hits, from, 'edge', '+outgoing edge');
    bumpHit(hits, dest, 'edge', '+incoming edge');
  });
  diff.removedEdges.forEach((key) => {
    const { from, to: dest } = splitEdgeKey(key);
    bumpHit(hits, from, 'edge', '−outgoing edge');
    bumpHit(hits, dest, 'edge', '−incoming edge');
  });
  return hits;
}

function sortedHits(hits: Map<string, Hit>): Hit[] {
  return [...hits.values()].sort((left, right) => right.touch - left.touch || left.id.localeCompare(right.id));
}

function buildImpactTop(hit: Hit, before: DiffModel, after: DiffModel, max: number): HTMLElement {
  const exists = (hit.id in before.nodes) || (hit.id in after.nodes);
  const top = el('div', 'dv-impact-top');
  top.appendChild(el('span', 'dv-impact-id', hit.id + (exists ? '' : ' (?)')));
  const barWrap = el('div', 'dv-impact-bar');
  const bar = el('div', `dv-impact-fill sev-${hit.sev}`);
  bar.style.width = `${(hit.touch / max) * 100}%`;
  barWrap.appendChild(bar);
  top.appendChild(barWrap);
  top.appendChild(el('span', 'dv-impact-n', `${hit.touch}×`));
  return top;
}

function buildImpactRow(hit: Hit, before: DiffModel, after: DiffModel, max: number): HTMLElement {
  const card = el('div', `dv-impact-row sev-${hit.sev}`);
  card.appendChild(buildImpactTop(hit, before, after, max));
  card.appendChild(el('div', 'dv-impact-why', hit.reasons.join(' · ')));
  return card;
}

function buildImpactRoot(list: Hit[], before: DiffModel, after: DiffModel): HTMLElement {
  const max = Math.max(1, ...list.map((hit) => hit.touch));
  const root = el('div', 'dv-impact');
  const cap = `blast radius · ${list.length} nodes touched · sorted by edges affected`;
  root.appendChild(el('div', 'dv-impact-cap', cap));
  list.forEach((hit) => root.appendChild(buildImpactRow(hit, before, after, max)));
  return root;
}

export function renderImpact(host: HTMLElement, arg: ViewArg): void {
  const { diff, before, after } = arg;
  host.innerHTML = '';
  if (isEmptyDiff(diff)) {
    host.appendChild(el('div', 'diff-empty', 'No changes — nothing impacted.'));
    return;
  }
  host.appendChild(buildImpactRoot(sortedHits(computeHits(diff)), before, after));
}
