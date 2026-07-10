/* =====================================================================
   files.ts — save / load .mmd files + load bodies.json (source viewer)
   ---------------------------------------------------------------------
   Responsibility: download the current diagram as a .mmd text file and
   load a .mmd/.txt file back in (reading it, applying the text, and
   fitting the view). Also loads a user-supplied bodies.json into
   ctx.bodies for the source viewer — read in-browser via FileReader,
   never uploaded. The two are separate uploads on purpose: the .mmd is
   the diagram; bodies.json is optional (and can be large).
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { MermaidApi } from './mermaid';
import type { CameraApi } from '../core/camera/camera';

export interface FilesApi {
  saveMmd: () => void;
  loadMmdText: (text: string) => void;
  loadBodies: (raw: unknown) => void;
  listDesigns: () => Promise<string[]>;
  saveDesign: (name: string) => Promise<void>;
  loadDesign: (name: string) => Promise<void>;
}

const DESIGN_MARK = '%% design-ui ';

/** Serialize a design draft to .design.mmd text: mermaid body, then one trailing `%% design-ui <uiJson>` line. */
export function toDesignFile(mmd: string, uiJson: string): string {
  return `${mmd}\n${DESIGN_MARK}${uiJson}\n`;
}

/** Parse .design.mmd text into { body, uiJson } by splitting off a SINGLE trailing `%% design-ui ...` line. */
export function parseDesignFile(text: string): { body: string; uiJson: string } {
  const lines = text.split('\n');
  let end = lines.length;
  if (end > 0 && lines[end - 1] === '') end--; // ignore one trailing newline
  const last = end > 0 ? lines[end - 1] : undefined;
  if (last !== undefined && last.startsWith(DESIGN_MARK)) {
    return { body: lines.slice(0, end - 1).join('\n'), uiJson: last.slice(DESIGN_MARK.length) };
  }
  return { body: text, uiJson: '' };
}

function downloadBlob(blob: Blob, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

// one code path for every <input type=file>: read the picked file as text,
// hand it to the callback, then reset the input so re-picking the same file
// fires another change event.
function wireFileInput(input: HTMLInputElement | null, onText: (text: string) => void): void {
  if (!input) return;
  input.onchange = (evt) => {
    const file = (evt.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onText(reader.result as string);
    reader.readAsText(file);
    (evt.target as HTMLInputElement).value = '';
  };
}

type BodyEntry = { kind: string; body: string; accepts?: string[]; returns?: string | null };

/** Validate + normalize one bodies.json value; null if it isn't a usable body entry. */
function parseBodyEntry(value: unknown): BodyEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.body !== 'string') return null; // a body string is the minimum we render
  return {
    kind: typeof entry.kind === 'string' ? entry.kind : 'source',
    body: entry.body,
    accepts: Array.isArray(entry.accepts) ? (entry.accepts as string[]) : undefined,
    returns: typeof entry.returns === 'string' ? entry.returns : null,
  };
}

/** raw bodies.json -> id->BodyEntry map, or null if raw isn't a usable object. */
function buildBodyMap(raw: unknown): Map<string, BodyEntry> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const map = new Map<string, BodyEntry>();
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseBodyEntry(value);
    if (entry) map.set(id, entry);
  }
  return map;
}

/** Builds the bodies.json applier: parses raw JSON into ctx.bodies, toasting on every outcome. */
function makeApplyBodies(ctx: AppContext, bodiesLabel: HTMLElement | null): (raw: unknown) => void {
  return function applyBodies(raw: unknown): void {
    const map = buildBodyMap(raw);
    if (!map) {
      ctx.hooks.toast('bodies.json must be a JSON object');
      return;
    }
    if (map.size === 0) {
      ctx.hooks.toast('No source bodies found in that file');
      return;
    }
    ctx.bodies = map;
    if (bodiesLabel) bodiesLabel.textContent = `Bodies (${map.size})`;
    ctx.hooks.renderInspector(); // refresh the source pane for the current selection
    ctx.hooks.toast(`Loaded ${map.size} source bodies`);
  };
}

// wires the bodies.json <input> to the applier — the source-viewer data,
// read locally and never uploaded. Separate file from the .mmd so a large
// bodies.json is optional: load just the diagram, or add bodies for the
// source pane.
function wireBodiesInput(ctx: AppContext, applyBodies: (raw: unknown) => void): void {
  wireFileInput(document.getElementById('bodiesInput') as HTMLInputElement | null, (text) => {
    try {
      applyBodies(JSON.parse(text));
    } catch {
      ctx.hooks.toast('Could not parse bodies.json');
    }
  });
}

async function fetchDesignNames(): Promise<string[]> {
  try {
    const res = await fetch('/novakai/designs');
    if (!res.ok) return [];
    const json = await res.json() as { names?: string[] };
    return Array.isArray(json.names) ? json.names : [];
  } catch { return []; }
}

async function writeDesign(ctx: AppContext, mermaid: MermaidApi, name: string): Promise<void> {
  const text = toDesignFile(mermaid.toMermaid(), ctx.hooks.getDesignDraft());
  try {
    await fetch('/novakai/designs/write', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text }),
    });
  } catch { ctx.hooks.toast('Design bridge unavailable'); }
}

async function readDesign(ctx: AppContext, loadMmdText: (text: string) => void, name: string): Promise<void> {
  try {
    const res = await fetch(`/novakai/designs/read?name=${encodeURIComponent(name)}`);
    if (!res.ok) return;
    const text = await res.text();
    const { body, uiJson } = parseDesignFile(text);
    loadMmdText(body);
    if (uiJson) ctx.hooks.restoreDesignDraft(uiJson);
  } catch { /* bridge absent: no-op */ }
}

/** The /novakai/designs read/write bridge (dev-only; absent bridge is a silent no-op). */
function makeDesignBridge(
  ctx: AppContext, mermaid: MermaidApi, loadMmdText: (text: string) => void,
): Pick<FilesApi, 'listDesigns' | 'saveDesign' | 'loadDesign'> {
  return {
    listDesigns: fetchDesignNames,
    saveDesign: (name) => writeDesign(ctx, mermaid, name),
    loadDesign: (name) => readDesign(ctx, loadMmdText, name),
  };
}

export function initFiles(ctx: AppContext, mermaid: MermaidApi, camera: CameraApi): FilesApi {
  const { mmd } = ctx.dom;

  function saveMmd(): void {
    downloadBlob(new Blob([mermaid.toMermaid()], { type: 'text/plain' }), 'diagram.mmd');
  }

  // one code path per verb regardless of surface: the legacy hidden input and
  // the unfold io tab both load a .mmd through this
  function loadMmdText(text: string): void {
    mmd.value = text;
    mermaid.applyText();
    camera.zoomToFit();
  }

  wireFileInput(document.getElementById('loadInput') as HTMLInputElement | null, loadMmdText);

  const bodiesLabel = document.getElementById('bodiesLabel');
  const applyBodies = makeApplyBodies(ctx, bodiesLabel);
  wireBodiesInput(ctx, applyBodies);

  const { listDesigns, saveDesign, loadDesign } = makeDesignBridge(ctx, mermaid, loadMmdText);

  return { saveMmd, loadMmdText, loadBodies: applyBodies, listDesigns, saveDesign, loadDesign };
}
