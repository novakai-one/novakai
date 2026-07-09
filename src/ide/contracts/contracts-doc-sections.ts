/* =====================================================================
   contracts-doc-sections.ts — per-section render builders for the K4
   certificate document. Split out of contracts-doc.ts (which keeps the
   rail/section-table dispatch + renderDocument); one small render
   function per SPEC_CONTRACTS.md §4 section, plus the shared DOM/collapse
   helpers those builders lean on. See contracts-doc.ts for the full
   module-header note on section order and interaction mechanism.
   ===================================================================== */

import type {
  ContractPacket, ContractRow, PlanChange, PlanChangeIntent, SubMapEdge, SubMapNode, Verdict, VerdictCase,
} from './contracts';
import { el } from './contracts-doc';

const CLS_PENDING = 'ctr-pending-line';
const CLS_SECTION = 'ctr-section';
const CLS_DEP_LINE = 'ctr-dep-line';

function pendingLine(text: string): HTMLElement { return el('div', CLS_PENDING, text); }
function sectionEl(): HTMLElement { return el('div', CLS_SECTION); }

function packetCmd(id: string): string {
  return `node tools/novakai/contract/contract.mjs --change ${id} --plan public/plan.json --json > public/contracts/${id}.packet.json`;
}
function verifyCmd(id: string): string {
  return `node tools/novakai/contract/verify-change.mjs --change ${id} --plan public/plan.json --json`;
}

/* ---------- shared collapse mechanism (proto .bd-collapse-head/.xwrap) ---------- */

function makeXwrap(content: HTMLElement): { wrap: HTMLElement; toggle: () => boolean } {
  const wrap = el('div', 'ctr-xwrap');
  const inner = el('div', 'ctr-xwrap-inner');
  inner.appendChild(content);
  wrap.appendChild(inner);
  const toggle = (): boolean => wrap.classList.toggle('ctr-xwrap--open');
  return { wrap, toggle };
}

/** a `▸ label  meta` trigger that reveals `content` on click — default
    CLOSED, caret rotates 90deg on open (declared delta: no keyboard-
    instant escape stack, KEY_DECISIONS latitude — polish, not load-bearing). */
function renderCollapsible(label: string, meta: string, content: HTMLElement): HTMLElement {
  const frag = document.createElement('div');
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'ctr-collapse-head';
  head.append(el('span', 'ctr-caret', '▸'), el('span', 'ctr-bch-label', label), el('span', 'ctr-collapse-meta', meta));
  const { wrap, toggle } = makeXwrap(content);
  head.onclick = () => head.classList.toggle('open', toggle());
  frag.append(head, wrap);
  return frag;
}

/* ---------- header ---------- */

function statusHue(status: string): string {
  if (status === 'built') return 'teal';
  if (status === 'pending' || status === 'drifted') return 'amber';
  return 'dim'; // missing / invalid / unrecognized — unproven, shown honestly (§6)
}

function renderStatusChip(verdict: Verdict | null): HTMLElement {
  const status = verdict?.structural.status ?? 'unverified';
  return el('span', `ctr-chip ctr-chip--${statusHue(verdict ? status : 'unverified')}`, status);
}

function headerTitle(row: ContractRow): string {
  return row.change ? row.change.id : `${row.record!.title} · ${row.record!.id}`;
}

export function renderHeader(row: ContractRow, planBase: string): HTMLElement {
  const header = el('div', 'ctr-header');
  header.appendChild(el('span', 'ctr-eyebrow', `plan · ${planBase}`));
  const topRow = el('div', 'ctr-toprow');
  topRow.append(el('span', 'ctr-title', headerTitle(row)), renderStatusChip(row.verdict));
  if (row.verdict) topRow.appendChild(el('span', 'ctr-verdict-word', row.verdict.verdict));
  header.appendChild(topRow);
  if (row.packet && !row.packet.coherent) {
    header.appendChild(el('div', 'ctr-problem-line', row.packet.coherenceProblems.join('; ')));
  }
  return header;
}

/* ---------- intent (plain language first) + technical layer (one toggle deep) ---------- */

const INTENT_LABELS: ReadonlyArray<readonly [keyof PlanChangeIntent, string]> = [
  ['problem', 'problem'], ['approach', 'approach'], ['rationale', 'rationale'],
  ['alternative', 'alternative'], ['tradeoff', 'tradeoff'],
];

function renderIntentBody(intent: PlanChangeIntent | null | undefined): HTMLElement {
  const box = el('div', 'ctr-intent');
  if (!intent) { box.appendChild(pendingLine('no intent recorded')); return box; }
  for (const [key, label] of INTENT_LABELS) {
    const text = intent[key];
    if (!text) continue;
    const line = el('p', 'ctr-intent-text');
    line.append(el('span', 'ctr-intent-label', label), text);
    box.appendChild(line);
  }
  return box;
}

const CLS_TECH_ROW = 'ctr-technical-row';

/** rule (i)/(ii): absent packet -> dim + the real producing command;
    present packet but signature/source null (an edge change, contract.mjs
    emits these null by construction) -> dim + honest caption, no command
    (there is no command that would make an edge change grow a signature). */
function technicalLines(packet: ContractPacket | null, id: string): HTMLElement {
  if (!packet) return pendingLine(`absent — ${packetCmd(id)}`);
  if (!packet.signature || !packet.source) return pendingLine('structure-only change — no symbol binding');
  const iface = packet.signature.interfaces[0];
  const wrap = el('div', 'ctr-tech-lines');
  wrap.appendChild(el('div', CLS_TECH_ROW, `${packet.signature.name}(${iface?.accepts.join(', ') ?? ''}) → ${iface?.returns.join(', ') ?? 'void'}`));
  wrap.appendChild(el('div', CLS_TECH_ROW, `${packet.source.path}::${packet.source.symbol}`));
  return wrap;
}

/** intent renders plain-language first, then the technical layer one
    collapse deep — the same smooth grid-rows 0fr->1fr reveal as every
    other section (coordinator: everything animates like the prototype).
    Only called when row.change is present — a record-only row has no
    plan intent to show. */
export function renderIntentSection(row: ContractRow, change: PlanChange): HTMLElement {
  const sec = sectionEl();
  sec.appendChild(renderIntentBody(row.packet?.intent ?? change.intent ?? null));
  sec.appendChild(renderCollapsible('technical', '', technicalLines(row.packet ?? null, change.id)));
  return sec;
}

/* ---------- trust seal (the keystone) ---------- */

/** the seal's animated hairline: an SVG rect with pathLength=1 so
    stroke-dashoffset 1->0 draws the border in one continuous stroke
    (proto .ts-frame, 1200ms house ease). */
function svgFrame(): SVGElement {
  const svg = svgEl('svg');
  svg.setAttribute('class', 'ctr-ts-frame');
  const rect = svgEl('rect');
  rect.setAttribute('pathLength', '1');
  svg.appendChild(rect);
  return svg;
}

/** ceremony: a PASS document draws its seal as it opens — a live
    unsealed->sealed reveal to the human (the only "live transition" this
    read-only, no-poll slice has). Non-PASS stays unsealed, dashed. */
function markSeal(sec: HTMLElement, trusted: boolean): void {
  if (!trusted) return;
  requestAnimationFrame(() => {
    sec.classList.add('sealing');
    requestAnimationFrame(() => sec.classList.add('sealed'));
    setTimeout(() => sec.classList.remove('sealing'), 1400);
  });
}

type SealKind = 'ran' | 'passed' | 'trusted';
const SEAL_LABELS: Record<SealKind, string> = {
  ran: 'The tests ran.', passed: 'The tests passed.', trusted: 'The work is trusted.',
};

function sealEvidence(kind: SealKind, verdict: Verdict | null): { text: string; filled: boolean } {
  const total = verdict?.behavioural.total ?? 0;
  const passed = verdict?.behavioural.passed ?? 0;
  const ran = !!verdict?.behavioural.hasContract;
  if (kind === 'ran') return { text: ran ? `${total} cases ran` : '—', filled: ran };
  if (kind === 'passed') {
    const filled = ran && passed === total;
    return { text: filled ? `${passed} / ${total} pass` : '—', filled };
  }
  const filled = verdict?.verdict === 'PASS';
  return { text: filled ? 'PASS' : '—', filled };
}

function renderCopyCmd(cmd: string): HTMLElement {
  const row = el('div', 'ctr-cmd-row');
  row.appendChild(el('span', 'ctr-cmd-text', cmd));
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'ctr-copy-btn';
  copy.textContent = '⧉ copy';
  copy.onclick = (evt) => {
    evt.stopPropagation();
    void navigator.clipboard?.writeText(cmd);
    copy.textContent = 'copied';
    copy.classList.add('copied');
    setTimeout(() => { copy.textContent = '⧉ copy'; copy.classList.remove('copied'); }, 1400);
  };
  row.appendChild(copy);
  return row;
}

/** per-test proof, real verdict.behavioural.cases[] only — no fabricated
    per-case CLI flag (verify-change.mjs only accepts --change). */
function renderCaseProofList(cases: VerdictCase[], cmd: string): HTMLElement {
  const box = el('div', 'ctr-proof');
  if (!cases.length) box.appendChild(pendingLine('no checks yet'));
  for (const kase of cases) {
    const line = el('div', 'ctr-tr-test');
    line.append(el('span', 'ctr-tr-test-name', kase.name), el('span', 'ctr-case-result', kase.pass ? 'pass' : 'fail'));
    box.appendChild(line);
  }
  box.appendChild(renderCopyCmd(cmd));
  return box;
}

function renderTrustedProof(verdict: Verdict, cmd: string): HTMLElement {
  const box = el('div', 'ctr-proof');
  box.appendChild(el('div', 'ctr-tr-test', `verdict ${verdict.verdictHash.slice(0, 12)} · structural ${verdict.structural.status}`));
  box.appendChild(renderCopyCmd(cmd));
  return box;
}

function sealProof(kind: SealKind, row: ContractRow, cmd: string): HTMLElement {
  const verdict = row.verdict;
  if (!verdict) return pendingLine(`unsealed — ${cmd}`);
  return kind === 'trusted' ? renderTrustedProof(verdict, cmd) : renderCaseProofList(verdict.behavioural.cases, cmd);
}

function sealRowHeader(label: string, ev: string, glyphCls: string): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'ctr-tr-row';
  row.append(
    el('span', `ctr-ts-glyph ${glyphCls}`.trim()),
    el('span', '', label),
    el('span', 'ctr-tr-leader'),
    el('span', 'ctr-tr-ev', ev),
  );
  return row;
}

/** one sworn sentence, one click deep to its real proof — the keystone
    rule (line 3 stays dim until 1+2 fill) is enforced by the renderer,
    not just by trusting the `verdict` enum string (SPEC_CONTRACTS §5). */
function sealLine(kind: SealKind, row: ContractRow, cmd: string, keystoneLocked: boolean): HTMLElement {
  const { text, filled } = sealEvidence(kind, row.verdict);
  const glyphCls = filled ? (kind === 'trusted' ? 'green' : 'teal') : '';
  const header = sealRowHeader(SEAL_LABELS[kind], text, glyphCls);
  header.classList.toggle('filled-teal', filled && kind !== 'trusted');
  header.classList.toggle('filled-green', filled && kind === 'trusted');
  header.classList.toggle('ctr-keystone-locked', kind === 'trusted' && keystoneLocked);
  const { wrap, toggle } = makeXwrap(sealProof(kind, row, cmd));
  header.onclick = () => toggle();
  const frag = el('div', '');
  frag.append(header, wrap);
  return frag;
}

export function renderTrustSeal(row: ContractRow): HTMLElement {
  const sec = el('div', 'ctr-seal');
  const verdict = row.verdict;
  const trusted = verdict?.verdict === 'PASS';
  const bothFilled = !!verdict && verdict.behavioural.hasContract && verdict.behavioural.passed === verdict.behavioural.total;
  const cmd = verifyCmd(row.change?.id ?? row.record!.id);
  const frame = svgFrame();
  sec.appendChild(frame);
  sec.append(sealLine('ran', row, cmd, false), sealLine('passed', row, cmd, false), sealLine('trusted', row, cmd, !bothFilled));
  if (trusted && verdict) sec.appendChild(el('div', 'ctr-ts-stamp', `sealed · ${verdict.verdictHash.slice(0, 12)}`));
  markSeal(sec, trusted);
  return sec;
}

/* ---------- acceptance criteria ---------- */

function caseResult(name: string, verdictCases: VerdictCase[] | undefined): { text: string; known: boolean } {
  const found = verdictCases?.find((kase) => kase.name === name);
  return found ? { text: found.pass ? 'pass' : 'fail', known: true } : { text: 'unverified', known: false };
}

function renderCaseRow(name: string, verdictCases: VerdictCase[] | undefined): HTMLElement {
  const row = el('div', 'ctr-case-row');
  const { text, known } = caseResult(name, verdictCases);
  row.append(el('span', 'ctr-case-name', name), el('span', `ctr-case-result${known ? '' : ' ctr-case-result--dim'}`, text));
  return row;
}

/** rule (ii): no acceptance block in the plan at all -> dim + honest
    caption, no command (E2 behavioural contracts are authored, not
    generated on demand). Only called when row.change is present. */
export function renderAcceptanceSection(row: ContractRow, change: PlanChange): HTMLElement {
  const sec = sectionEl();
  const cases = change.acceptance?.cases;
  if (!cases || !cases.length) {
    sec.classList.add('pending');
    sec.appendChild(pendingLine('no behavioural contract in the plan (E2)'));
    return sec;
  }
  for (const kase of cases) sec.appendChild(renderCaseRow(kase.name, row.verdict?.behavioural.cases));
  return sec;
}

/* ---------- contract (patch + map + slice) + impact slice ---------- */

function blastLine(packet: ContractPacket): string {
  const br = packet.blastRadius;
  if (!br) return 'edge change — no node-level blast radius';
  if (!br.affected.length) return 'no downstream dependents recorded';
  return `${br.affected.length} downstream, maxDepth ${br.maxDepth}, entry [${br.entryPoints.join(', ')}]`;
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag: string): SVGElement { return document.createElementNS(SVGNS, tag); }

function sliceNodeLabel(node: SubMapNode): string {
  const parts = node.id.split('__');
  return parts[1] ?? node.id;
}

const NODE_W = 120;
const NODE_H = 32;
const GAP_X = 150;
const MARGIN = 16;

function sliceEdge(from: number, to: number): SVGElement {
  const line = svgEl('line');
  const midY = 20 + NODE_H / 2;
  line.setAttribute('x1', String(from + NODE_W));
  line.setAttribute('y1', String(midY));
  line.setAttribute('x2', String(to));
  line.setAttribute('y2', String(midY));
  line.setAttribute('class', 'ctr-slice-edge');
  return line;
}

function sliceNode(node: SubMapNode, left: number): SVGElement {
  const group = svgEl('g');
  group.setAttribute('class', 'ctr-slice-node');
  const rect = svgEl('rect');
  rect.setAttribute('x', String(left)); rect.setAttribute('y', '20');
  rect.setAttribute('width', String(NODE_W)); rect.setAttribute('height', String(NODE_H)); rect.setAttribute('rx', '6');
  const text = svgEl('text');
  text.setAttribute('x', String(left + NODE_W / 2)); text.setAttribute('y', String(20 + NODE_H / 2 + 4));
  text.setAttribute('text-anchor', 'middle');
  text.textContent = sliceNodeLabel(node);
  group.append(rect, text);
  return group;
}

function buildSliceSvg(nodes: Record<string, SubMapNode>, edges: readonly SubMapEdge[]): SVGSVGElement {
  const ids = Object.keys(nodes);
  const posOf = (id: string): number => MARGIN + ids.indexOf(id) * GAP_X;
  const svg = svgEl('svg') as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${MARGIN + ids.length * GAP_X} ${40 + NODE_H}`);
  for (const edge of edges) svg.appendChild(sliceEdge(posOf(edge.from), posOf(edge.to)));
  for (const id of ids) svg.appendChild(sliceNode(nodes[id], posOf(id)));
  return svg;
}

function renderImpactSlice(packet: ContractPacket): HTMLElement {
  const box = el('div', 'ctr-impact');
  box.appendChild(el('div', CLS_DEP_LINE, blastLine(packet)));
  const nodeCount = Object.keys(packet.subMap?.nodes ?? {}).length;
  if (!packet.subMap || !nodeCount) {
    box.appendChild(pendingLine('no dependency slice to draw'));
    return box;
  }
  const sliceBox = el('div', 'ctr-slice');
  sliceBox.appendChild(buildSliceSvg(packet.subMap.nodes, packet.subMap.edges));
  sliceBox.appendChild(el('div', 'ctr-caption', `dependency slice — ${nodeCount} nodes touched`));
  box.appendChild(sliceBox);
  return box;
}

function renderContractBody(packet: ContractPacket): HTMLElement {
  const box = el('div', '');
  box.appendChild(el('div', CLS_DEP_LINE, `contract v${packet.contractVersion} · ${packet.contractHash.slice(0, 12)}`));
  box.appendChild(el('div', CLS_DEP_LINE, packet.deps.length ? `deps: ${packet.deps.join(', ')}` : 'no dependencies'));
  if (!packet.coherent) for (const problem of packet.coherenceProblems) box.appendChild(el('div', 'ctr-problem-line', problem));
  box.appendChild(renderImpactSlice(packet));
  return box;
}

export function renderContractSection(row: ContractRow): HTMLElement {
  const sec = sectionEl();
  const packet = row.packet;
  if (!packet) {
    sec.classList.add('pending');
    sec.appendChild(pendingLine(`absent — ${packetCmd(row.change?.id ?? row.record!.id)}`));
    return sec;
  }
  const meta = `${Object.keys(packet.subMap?.nodes ?? {}).length} nodes`;
  sec.appendChild(renderCollapsible('contract', meta, renderContractBody(packet)));
  return sec;
}

/* ---------- activity (empty until K6 — no fake feed, ever) ---------- */

export function renderActivitySection(): HTMLElement {
  const sec = sectionEl();
  sec.appendChild(el('div', 'ctr-activity-line', 'activity arrives when agents run in the repo'));
  sec.appendChild(el('div', 'ctr-activity-sub', 'agents — xterm over the dev-server bridge · K6'));
  return sec;
}
