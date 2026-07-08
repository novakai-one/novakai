/* =====================================================================
   contract-record.ts — K4 Contracts tab: contract lifecycle record model
   ---------------------------------------------------------------------
   Pure model only — no IO, no DOM. A ContractRecord is the lifecycle
   state the Contracts tab now writes (via contract-store.ts's dev file
   bridge): status + refs to the real artifacts (plan change / packet /
   verdict / design / session / decision) plus a forward-only history.
   ===================================================================== */

export const STATUSES = ['draft', 'active', 'review', 'completed'] as const;
export type ContractStatus = typeof STATUSES[number];

export interface ContractRefs {
  plan: string | null;
  packet: string | null;
  verdict: string | null;
  design: string | null;
  sessionId: string | null;
  decision: string | null;
}

export interface ContractRecord {
  v: 1;
  id: string;
  title: string;
  status: ContractStatus;
  created: string;
  updated: string;
  refs: ContractRefs;
  history: { at: string; from: ContractStatus; to: ContractStatus }[];
}

const EMPTY_REFS: ContractRefs = {
  plan: null, packet: null, verdict: null, design: null, sessionId: null, decision: null,
};

export function createRecord(id: string, title: string, refs?: Partial<ContractRefs>): ContractRecord {
  const now = new Date().toISOString();
  return {
    'v': 1, // quoted: a bare `v` key trips id-length (min 2) even though the field itself is the frozen bridge schema's version tag
    id,
    title,
    status: 'draft',
    created: now,
    updated: now,
    refs: { ...EMPTY_REFS, ...refs },
    history: [],
  };
}

/** forward-only chain: draft -> active -> review -> completed -> (terminal) */
export function nextStatus(status: ContractStatus): ContractStatus | null {
  const idx = STATUSES.indexOf(status);
  const next = STATUSES[idx + 1];
  return next ?? null;
}

/** returns a NEW record one step further along the chain — never mutates `record`. */
export function advance(record: ContractRecord): ContractRecord {
  const to = nextStatus(record.status);
  if (to === null) throw new Error(`cannot advance a completed contract (${record.id})`);
  const at = new Date().toISOString();
  return {
    ...record,
    status: to,
    updated: at,
    history: [...record.history, { at, from: record.status, to }],
  };
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** client-side slug validation, shared by every free-form create flow. */
export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function isRefs(value: unknown): value is ContractRefs {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  const keys: (keyof ContractRefs)[] = ['plan', 'packet', 'verdict', 'design', 'sessionId', 'decision'];
  return keys.every((key) => obj[key] === null || typeof obj[key] === 'string');
}

function isHistory(value: unknown): value is ContractRecord['history'] {
  return Array.isArray(value) && value.every((entry) => (
    !!entry && typeof entry === 'object'
    && typeof (entry as Record<string, unknown>).at === 'string'
    && STATUSES.includes((entry as Record<string, unknown>).from as ContractStatus)
    && STATUSES.includes((entry as Record<string, unknown>).to as ContractStatus)
  ));
}

export function isRecord(value: unknown): value is ContractRecord {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return obj.v === 1
    && typeof obj.id === 'string' && ID_RE.test(obj.id)
    && typeof obj.title === 'string'
    && STATUSES.includes(obj.status as ContractStatus)
    && typeof obj.created === 'string'
    && typeof obj.updated === 'string'
    && isRefs(obj.refs)
    && isHistory(obj.history);
}
