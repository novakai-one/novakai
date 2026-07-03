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
}

export function initFiles(ctx: AppContext, mermaid: MermaidApi, camera: CameraApi): FilesApi {
  const { mmd } = ctx.dom;

  function downloadBlob(blob: Blob, name: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function saveMmd(): void {
    downloadBlob(new Blob([mermaid.toMermaid()], { type: 'text/plain' }), 'diagram.mmd');
  }

  // one code path per verb regardless of surface: the legacy hidden input and
  // the unfold io tab both load a .mmd through this
  function loadMmdText(text: string): void {
    mmd.value = text; mermaid.applyText(); camera.zoomToFit();
  }

  // wire the hidden file input
  const loadInput = document.getElementById('loadInput') as HTMLInputElement | null;
  if (loadInput) {
    loadInput.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => loadMmdText(rd.result as string);
      rd.readAsText(f);
      (e.target as HTMLInputElement).value = '';
    };
  }

  // wire the bodies.json loader — the source-viewer data, read locally and
  // never uploaded. Separate file from the .mmd so a large bodies.json is
  // optional: load just the diagram, or add bodies for the source pane.
  const bodiesInput = document.getElementById('bodiesInput') as HTMLInputElement | null;
  const bodiesLabel = document.getElementById('bodiesLabel');

  type BodyEntry = { kind: string; body: string; accepts?: string[]; returns?: string | null };

  function applyBodies(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      ctx.hooks.toast('bodies.json must be a JSON object');
      return;
    }
    const map = new Map<string, BodyEntry>();
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      if (typeof o.body !== 'string') continue; // a body string is the minimum we render
      map.set(id, {
        kind: typeof o.kind === 'string' ? o.kind : 'source',
        body: o.body,
        accepts: Array.isArray(o.accepts) ? (o.accepts as string[]) : undefined,
        returns: typeof o.returns === 'string' ? o.returns : null,
      });
    }
    if (map.size === 0) {
      ctx.hooks.toast('No source bodies found in that file');
      return;
    }
    ctx.bodies = map;
    if (bodiesLabel) bodiesLabel.textContent = `Bodies (${map.size})`;
    ctx.hooks.renderInspector(); // refresh the source pane for the current selection
    ctx.hooks.toast(`Loaded ${map.size} source bodies`);
  }

  if (bodiesInput) {
    bodiesInput.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { applyBodies(JSON.parse(rd.result as string)); }
        catch { ctx.hooks.toast('Could not parse bodies.json'); }
      };
      rd.readAsText(f);
      (e.target as HTMLInputElement).value = '';
    };
  }

  return { saveMmd, loadMmdText, loadBodies: applyBodies };
}
