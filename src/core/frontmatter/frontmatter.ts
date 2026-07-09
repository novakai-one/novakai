/* =====================================================================
   frontmatter.ts — per-node public-interface metadata
   ---------------------------------------------------------------------
   Responsibility: own the Frontmatter value type's lifecycle helpers —
   create an empty one, test emptiness, and serialize/parse it to and
   from Mermaid %% comment lines. Pure functions only; no DOM, no model
   mutation. The inspector/render/mermaid modules call these.

   Mermaid wire format (one node's frontmatter, all on %% comment lines
   so Mermaid itself ignores them):

     %% fm:meta n3 name=Zustand store
     %% fm:meta n3 desc=central app store
     %% fm:meta n3 state=count
     %% fm:meta n3 i0.name=dispatch
     %% fm:meta n3 i0.accepts=action: Action
     %% fm:meta n3 i0.returns=void
     %% fm:meta n3 i1.name=select
     %% fm:meta n3 i1.accepts=key: string
     %% fm:meta n3 i1.returns=Snapshot

   name/desc are node-level and appear at most once. state is node-level
   and repeatable. accepts/returns belong to a numbered interface (i0, i1,
   …); emit one line per item so a value can contain any character except
   a newline (including '|'). Legacy bare `accepts=`/`returns=` lines (no
   i<N> prefix) are still parsed and folded into interface 0.
   ===================================================================== */

import type { Frontmatter, NodeInterface, DiagramNode } from '../types/types';

export function emptyInterface(): NodeInterface {
  return { name: '', accepts: [], returns: [] };
}

export function emptyFrontmatter(): Frontmatter {
  return { name: '', description: '', state: [], interfaces: [] };
}

/**
 * Coerce any value into a valid Frontmatter. Tolerates legacy objects from
 * before the interfaces refactor: a flat `accepts`/`returns` pair is folded
 * into a single interface 0. Guarantees `interfaces` is always an array so
 * the rest of the app never reads `undefined.map` / iterates `undefined`.
 */
/** Coerce one raw `interfaces[]` entry into a valid NodeInterface. */
function normalizeInterfaceEntry(raw: unknown): NodeInterface {
  const iface = (raw ?? {}) as Record<string, unknown>;
  return {
    name: typeof iface.name === 'string' ? iface.name : '',
    accepts: Array.isArray(iface.accepts) ? iface.accepts.slice() : [],
    returns: Array.isArray(iface.returns) ? iface.returns.slice() : [],
  };
}

/** Fold a legacy flat accepts/returns pair (pre-interfaces schema) into interface 0. */
function legacyInterfaces(record: Record<string, unknown>): NodeInterface[] {
  if (!Array.isArray(record.accepts) && !Array.isArray(record.returns)) return [];
  return [{
    name: '',
    accepts: Array.isArray(record.accepts) ? record.accepts.slice() : [],
    returns: Array.isArray(record.returns) ? record.returns.slice() : [],
  }];
}

export function normalizeFrontmatter(raw: unknown): Frontmatter {
  const out = emptyFrontmatter();
  if (!raw || typeof raw !== 'object') return out;
  const record = raw as Record<string, unknown>;
  if (typeof record.name === 'string') out.name = record.name;
  if (typeof record.description === 'string') out.description = record.description;
  if (Array.isArray(record.state)) out.state = record.state.slice();
  out.interfaces = Array.isArray(record.interfaces)
    ? (record.interfaces as unknown[]).map(normalizeInterfaceEntry)
    : legacyInterfaces(record);
  return out;
}

/** True when an interface has no name and no accepts/returns. */
function isInterfaceEmpty(iface: NodeInterface): boolean {
  return !iface.name.trim()
    && iface.accepts.every((val) => !val.trim())
    && iface.returns.every((val) => !val.trim());
}

/** True when every field is blank — used to decide whether to persist it. */
export function isFrontmatterEmpty(meta: Frontmatter | undefined): boolean {
  if (!meta) return true;
  return !meta.name.trim()
    && !meta.description.trim()
    && meta.state.every((val) => !val.trim())
    && (meta.interfaces ?? []).every(isInterfaceEmpty);
}

/** Drop blank list entries and empty interfaces so serialization stays clean. */
export function pruneFrontmatter(meta: Frontmatter): Frontmatter {
  return {
    name: meta.name.trim(),
    description: meta.description.trim(),
    state: meta.state.map((val) => val.trim()).filter(Boolean),
    interfaces: (meta.interfaces ?? [])
      .map((iface) => ({
        name: iface.name.trim(),
        accepts: iface.accepts.map((val) => val.trim()).filter(Boolean),
        returns: iface.returns.map((val) => val.trim()).filter(Boolean),
      }))
      .filter((iface) => !isInterfaceEmpty(iface)),
  };
}

/** A safe single-line encoding (frontmatter values can't contain newlines). */
function clean(raw: string): string {
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

/** Serialize one node's frontmatter to Mermaid comment lines (may be empty). */
export function frontmatterToMermaid(id: string, meta: Frontmatter | undefined): string {
  if (isFrontmatterEmpty(meta)) return '';
  const pruned = pruneFrontmatter(meta as Frontmatter);
  let out = '';
  if (pruned.name) out += `%% fm:meta ${id} name=${clean(pruned.name)}\n`;
  if (pruned.description) out += `%% fm:meta ${id} desc=${clean(pruned.description)}\n`;
  for (const val of pruned.state) out += `%% fm:meta ${id} state=${clean(val)}\n`;
  pruned.interfaces.forEach((iface, idx) => {
    if (iface.name) out += `%% fm:meta ${id} i${idx}.name=${clean(iface.name)}\n`;
    for (const acceptVal of iface.accepts) out += `%% fm:meta ${id} i${idx}.accepts=${clean(acceptVal)}\n`;
    for (const returnVal of iface.returns) out += `%% fm:meta ${id} i${idx}.returns=${clean(returnVal)}\n`;
  });
  return out;
}

/**
 * Match a single `%% fm:meta <id> <key>=<value>` line. Returns the parsed
 * record or null. For interface lines, `iface` is the numeric index and
 * `key` is the interface subkey (name/accepts/returns). For node-level
 * lines, `iface` is undefined. Legacy bare accepts/returns parse with
 * iface = 0. The caller accumulates these into per-node Frontmatter.
 */
export function matchFrontmatterLine(line: string):
  { id: string; key: string; value: string; iface?: number } | null {
  const match = line.match(
    /^%% fm:meta (\w+) (?:i(\d+)\.(name|accepts|returns)|(name|desc|state|accepts|returns))=(.*)$/,
  );
  if (!match) return null;
  const id = match[1];
  const value = match[5];
  if (match[2] !== undefined) {
    // interface-scoped line: i<N>.<subkey>
    return { id, key: match[3], value, iface: +match[2] };
  }
  const nodeKey = match[4];
  // legacy bare accepts/returns -> interface 0
  if (nodeKey === 'accepts' || nodeKey === 'returns') {
    return { id, key: nodeKey, value, iface: 0 };
  }
  return { id, key: nodeKey, value };
}

/** Ensure interfaces[index] exists, filling any gaps with empty interfaces. */
function ensureInterface(meta: Frontmatter, index: number): NodeInterface {
  while (meta.interfaces.length <= index) meta.interfaces.push(emptyInterface());
  return meta.interfaces[index];
}

/** Fold one iN.<key> line into the target interface. */
function applyInterfaceLine(iface: NodeInterface, key: string, value: string): void {
  switch (key) {
    case 'name':
      iface.name = value;
      break;
    case 'accepts':
      iface.accepts.push(value);
      break;
    case 'returns':
      iface.returns.push(value);
      break;
  }
}

/** Fold one node-level (name/desc/state) line into the frontmatter accumulator. */
function applyNodeLine(meta: Frontmatter, key: string, value: string): void {
  switch (key) {
    case 'name':
      meta.name = value;
      break;
    case 'desc':
      meta.description = value;
      break;
    case 'state':
      meta.state.push(value);
      break;
  }
}

/** Fold a parsed line into a (possibly new) frontmatter accumulator. */
export function applyFrontmatterLine(
  acc: Record<string, Frontmatter>,
  parsed: { id: string; key: string; value: string; iface?: number },
): void {
  const meta = acc[parsed.id] ?? (acc[parsed.id] = emptyFrontmatter());
  if (parsed.iface !== undefined) {
    applyInterfaceLine(ensureInterface(meta, parsed.iface), parsed.key, parsed.value);
    return;
  }
  applyNodeLine(meta, parsed.key, parsed.value);
}

/* =====================================================================
   type references — a typed slot is stored as the raw string
   "varName: Type". The var name is optional; the type is the identity
   used to cross-reference the same type across the whole diagram.
   ===================================================================== */

/** A parsed accepts/returns/state entry. */
export interface TypeRef {
  /** optional variable/param name (left of the colon); '' when absent */
  varName: string;
  /** the type identity used for cross-referencing; not split further */
  type: string;
}

/** Split a raw "name: Type" entry into its var-name and type parts. */
export function parseTypeRef(raw: string): TypeRef {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(':');
  if (colon === -1) return { varName: '', type: trimmed };
  return { varName: trimmed.slice(0, colon).trim(), type: trimmed.slice(colon + 1).trim() };
}

/** Every type name referenced anywhere in one node's frontmatter. */
export function frontmatterTypeNames(meta: Frontmatter): string[] {
  const out: string[] = [];
  const push = (raw: string): void => {
    const typeName = parseTypeRef(raw).type;
    if (typeName) out.push(typeName);
  };
  if (meta.name.trim()) out.push(meta.name.trim());
  meta.state.forEach(push);
  for (const iface of meta.interfaces ?? []) {
    iface.accepts.forEach(push);
    iface.returns.forEach(push);
  }
  return out;
}

/** True when a node's frontmatter references `type` (name/state/accepts/returns). */
export function nodeUsesType(meta: Frontmatter | undefined, type: string): boolean {
  if (!meta || !type) return false;
  return frontmatterTypeNames(meta).includes(type);
}

/** Distinct, sorted type names across every node's frontmatter. */
export function allTypeNames(nodes: Record<string, DiagramNode>): string[] {
  const set = new Set<string>();
  for (const id in nodes) {
    const meta = nodes[id].fm;
    if (meta) for (const typeName of frontmatterTypeNames(meta)) set.add(typeName);
  }
  return [...set].sort((nameA, nameB) => nameA.localeCompare(nameB));
}
