// traceProbe.ts — REMOVABLE dev-only state tracer for NovaKai.
//
// Records every Zustand store change (value diff + the call site that caused it)
// into a structured log you export and hand to Claude.
//
// WHY THIS SHAPE: DocShape is immutable here — managers return new objects and
// commit them through store setters. So the place to watch is the store, not the
// object. Zustand calls subscribers synchronously inside set(), so the stack at
// subscribe time still contains the manager line that committed the change.
//
// REMOVE COMPLETELY:
//   1. delete the line  import "./lib/traceProbe";  from src/main.tsx
//   2. delete this file
// It mutates no app state and changes no shapes. In a production build DEV is
// false, so every side effect below is skipped.
//
// CAPTURE A BUG (browser console):
//   __trace.mark("start: <action>")
//   ...do the action that produces the wrong value...
//   __trace.mark("end")
//   __trace.save()        // downloads novakai-trace.jsonl  -> upload to Claude
//
// API: __trace.dump() __trace.save() __trace.clear() __trace.events(bool)
//      __trace.off()  __trace.trace(store, name)

import { useWorkspaceStore } from "../components/store/useWorkspaceStore";

type Leaf = { path: string; prev: unknown; next: unknown };
type TraceEvent =
  | { seq: number; t: number; kind: "change"; store: string; changes: Leaf[]; by: string }
  | { seq: number; t: number; kind: "mark"; label: string }
  | { seq: number; t: number; kind: "input"; type: string; target: string };

const DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

const log: TraceEvent[] = [];
const MAX = 20000;
let seq = 0;
let tagInputs = true;
const t0 = performance.now();
const now = () => Number((performance.now() - t0).toFixed(1));
const unsubs: Array<() => void> = [];

function push(e: TraceEvent) {
  log.push(e);
  if (log.length > MAX) log.shift();
}

// Safe, depth-capped, cycle-safe value snapshot for logging.
function snap(v: unknown, d = 0, seen = new WeakSet<object>()): unknown {
  if (v === null || typeof v !== "object") {
    return typeof v === "function" ? `[fn ${(v as { name?: string }).name || "anon"}]` : v;
  }
  if (seen.has(v as object)) return "[circular]";
  if (d >= 3) return Array.isArray(v) ? `[array(${(v as unknown[]).length})]` : "[object]";
  seen.add(v as object);
  if (Array.isArray(v)) return (v.length > 20 ? v.slice(0, 20) : v).map((x) => snap(x, d + 1, seen));
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const k of Object.keys(v as object)) {
    if (n++ > 30) { out["\u2026"] = "[more]"; break; }
    try { out[k] = snap((v as Record<string, unknown>)[k], d + 1, seen); } catch { out[k] = "[unreadable]"; }
  }
  return out;
}

// Collect leaf-level differences between two values. Unchanged branches are
// reference-equal (immutable updates reuse them) so they short-circuit instantly.
function diff(path: string, a: unknown, b: unknown, out: Leaf[], depth = 0): void {
  if (Object.is(a, b)) return;
  const ao = a !== null && typeof a === "object";
  const bo = b !== null && typeof b === "object";
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b) || depth >= 4 || out.length >= 200) {
    out.push({ path: path || "(root)", prev: snap(a), next: snap(b) });
    return;
  }
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ar), ...Object.keys(br)])) {
    diff(path ? `${path}.${k}` : k, ar[k], br[k], out, depth + 1);
    if (out.length >= 200) break;
  }
}

// First frame in your source: drops this file, node_modules and zustand frames.
function callsite(): string {
  const lines = (new Error().stack || "").split("\n").slice(1);
  for (const line of lines) {
    if (line.includes("traceProbe") || line.includes("node_modules") || /zustand/.test(line)) continue;
    const t = line.trim().replace(/^at\s+/, "");
    if (t) return t;
  }
  return "unknown";
}

// Flatten one event into table rows for console.table.
function flat(e: TraceEvent): Record<string, unknown>[] {
  if (e.kind === "change") {
    return e.changes.map((c) => ({ seq: e.seq, t: e.t, store: e.store, path: c.path, prev: c.prev, next: c.next, by: e.by }));
  }
  return [{ seq: e.seq, t: e.t, kind: e.kind, info: e.kind === "mark" ? e.label : e.type }];
}

// Subscribe to any zustand store (has getState + subscribe). One line per store.
export function traceStore(
  store: { subscribe: (l: (n: unknown, p: unknown) => void) => () => void },
  name: string,
): void {
  if (!DEV || !store?.subscribe) return;
  const unsub = store.subscribe((next, prev) => {
    const changes: Leaf[] = [];
    diff("", prev, next, changes);
    if (changes.length === 0) return;
    push({ seq: seq++, t: now(), kind: "change", store: name, changes, by: callsite() });
  });
  unsubs.push(unsub);
}

if (DEV && typeof window !== "undefined") {
  traceStore(useWorkspaceStore, "workspace");

  const onInput = (e: Event) => {
    if (!tagInputs) return;
    const tgt = e.target as { tagName?: string; id?: string } | null;
    const label = tgt?.tagName ? `${tgt.tagName.toLowerCase()}${tgt.id ? "#" + tgt.id : ""}` : "?";
    push({ seq: seq++, t: now(), kind: "input", type: e.type, target: label });
  };
  for (const type of ["pointerdown", "pointerup", "keydown"]) {
    window.addEventListener(type, onInput, true);
  }

  (window as unknown as { __trace: unknown }).__trace = {
    mark: (label: string) => push({ seq: seq++, t: now(), kind: "mark", label }),
    dump: () => { console.table(log.flatMap(flat)); return log; },
    save: () => {
      const body = log.map((e) => JSON.stringify(e)).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }));
      a.download = "novakai-trace.jsonl";
      a.click();
      URL.revokeObjectURL(a.href);
    },
    clear: () => { log.length = 0; seq = 0; },
    events: (on: boolean) => { tagInputs = on; },
    off: () => { unsubs.forEach((u) => u()); unsubs.length = 0; },
    trace: traceStore,
    raw: log,
  };

  console.log("[trace] active on workspace store. __trace.save() to export, __trace.off() to stop.");
}

export {};
