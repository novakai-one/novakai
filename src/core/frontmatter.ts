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

import type { Frontmatter, NodeInterface, DiagramNode } from './types';

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
export function normalizeFrontmatter(raw: unknown): Frontmatter {
  const out = emptyFrontmatter();
  if (!raw || typeof raw !== 'object') return out;
  const fm = raw as Record<string, unknown>;
  if (typeof fm.name === 'string') out.name = fm.name;
  if (typeof fm.description === 'string') out.description = fm.description;
  if (Array.isArray(fm.state)) out.state = fm.state.slice();
  if (Array.isArray(fm.interfaces)) {
    out.interfaces = (fm.interfaces as unknown[]).map((i) => {
      const iface = (i ?? {}) as Record<string, unknown>;
      return {
        name: typeof iface.name === 'string' ? iface.name : '',
        accepts: Array.isArray(iface.accepts) ? iface.accepts.slice() : [],
        returns: Array.isArray(iface.returns) ? iface.returns.slice() : [],
      };
    });
  } else if (Array.isArray(fm.accepts) || Array.isArray(fm.returns)) {
    // legacy flat shape -> fold into interface 0
    out.interfaces = [{
      name: '',
      accepts: Array.isArray(fm.accepts) ? fm.accepts.slice() : [],
      returns: Array.isArray(fm.returns) ? fm.returns.slice() : [],
    }];
  }
  return out;
}

/** True when an interface has no name and no accepts/returns. */
function isInterfaceEmpty(iface: NodeInterface): boolean {
  return !iface.name.trim()
    && iface.accepts.every((s) => !s.trim())
    && iface.returns.every((s) => !s.trim());
}

/** True when every field is blank — used to decide whether to persist it. */
export function isFrontmatterEmpty(fm: Frontmatter | undefined): boolean {
  if (!fm) return true;
  return !fm.name.trim()
    && !fm.description.trim()
    && fm.state.every((s) => !s.trim())
    && (fm.interfaces ?? []).every(isInterfaceEmpty);
}

/** Drop blank list entries and empty interfaces so serialization stays clean. */
export function pruneFrontmatter(fm: Frontmatter): Frontmatter {
  return {
    name: fm.name.trim(),
    description: fm.description.trim(),
    state: fm.state.map((s) => s.trim()).filter(Boolean),
    interfaces: (fm.interfaces ?? [])
      .map((iface) => ({
        name: iface.name.trim(),
        accepts: iface.accepts.map((s) => s.trim()).filter(Boolean),
        returns: iface.returns.map((s) => s.trim()).filter(Boolean),
      }))
      .filter((iface) => !isInterfaceEmpty(iface)),
  };
}

/** A safe single-line encoding (frontmatter values can't contain newlines). */
function clean(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').trim();
}

/** Serialize one node's frontmatter to Mermaid comment lines (may be empty). */
export function frontmatterToMermaid(id: string, fm: Frontmatter | undefined): string {
  if (isFrontmatterEmpty(fm)) return '';
  const f = pruneFrontmatter(fm as Frontmatter);
  let out = '';
  if (f.name) out += `%% fm:meta ${id} name=${clean(f.name)}\n`;
  if (f.description) out += `%% fm:meta ${id} desc=${clean(f.description)}\n`;
  for (const s of f.state) out += `%% fm:meta ${id} state=${clean(s)}\n`;
  f.interfaces.forEach((iface, n) => {
    if (iface.name) out += `%% fm:meta ${id} i${n}.name=${clean(iface.name)}\n`;
    for (const a of iface.accepts) out += `%% fm:meta ${id} i${n}.accepts=${clean(a)}\n`;
    for (const r of iface.returns) out += `%% fm:meta ${id} i${n}.returns=${clean(r)}\n`;
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
  const m = line.match(
    /^%% fm:meta (\w+) (?:i(\d+)\.(name|accepts|returns)|(name|desc|state|accepts|returns))=(.*)$/,
  );
  if (!m) return null;
  const id = m[1];
  const value = m[5];
  if (m[2] !== undefined) {
    // interface-scoped line: i<N>.<subkey>
    return { id, key: m[3], value, iface: +m[2] };
  }
  const nodeKey = m[4];
  // legacy bare accepts/returns -> interface 0
  if (nodeKey === 'accepts' || nodeKey === 'returns') {
    return { id, key: nodeKey, value, iface: 0 };
  }
  return { id, key: nodeKey, value };
}

/** Ensure interfaces[i] exists, filling any gaps with empty interfaces. */
function ensureInterface(fm: Frontmatter, i: number): NodeInterface {
  while (fm.interfaces.length <= i) fm.interfaces.push(emptyInterface());
  return fm.interfaces[i];
}

/** Fold a parsed line into a (possibly new) frontmatter accumulator. */
export function applyFrontmatterLine(
  acc: Record<string, Frontmatter>,
  parsed: { id: string; key: string; value: string; iface?: number },
): void {
  const fm = acc[parsed.id] ?? (acc[parsed.id] = emptyFrontmatter());
  const v = parsed.value;
  if (parsed.iface !== undefined) {
    const iface = ensureInterface(fm, parsed.iface);
    switch (parsed.key) {
      case 'name': iface.name = v; break;
      case 'accepts': iface.accepts.push(v); break;
      case 'returns': iface.returns.push(v); break;
    }
    return;
  }
  switch (parsed.key) {
    case 'name': fm.name = v; break;
    case 'desc': fm.description = v; break;
    case 'state': fm.state.push(v); break;
  }
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
  const s = raw.trim();
  const colon = s.indexOf(':');
  if (colon === -1) return { varName: '', type: s };
  return { varName: s.slice(0, colon).trim(), type: s.slice(colon + 1).trim() };
}

/** Every type name referenced anywhere in one node's frontmatter. */
export function frontmatterTypeNames(fm: Frontmatter): string[] {
  const out: string[] = [];
  const push = (raw: string): void => {
    const t = parseTypeRef(raw).type;
    if (t) out.push(t);
  };
  if (fm.name.trim()) out.push(fm.name.trim());
  fm.state.forEach(push);
  for (const iface of fm.interfaces ?? []) {
    iface.accepts.forEach(push);
    iface.returns.forEach(push);
  }
  return out;
}

/** True when a node's frontmatter references `type` (name/state/accepts/returns). */
export function nodeUsesType(fm: Frontmatter | undefined, type: string): boolean {
  if (!fm || !type) return false;
  return frontmatterTypeNames(fm).includes(type);
}

/** Distinct, sorted type names across every node's frontmatter. */
export function allTypeNames(nodes: Record<string, DiagramNode>): string[] {
  const set = new Set<string>();
  for (const id in nodes) {
    const fm = nodes[id].fm;
    if (fm) for (const t of frontmatterTypeNames(fm)) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
