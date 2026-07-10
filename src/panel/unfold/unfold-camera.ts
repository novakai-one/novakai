/* unfold-camera.ts — the pure camera resolver for one unfold repaint
   (M10 factor-to-pure). fitView and reframeToFit hand-duplicated the same
   clamped-fit arithmetic; this is that arithmetic lifted into one
   dependency-free function so it's provable outside the browser (E2/H1;
   ufEscAction / ufVerbAllowed precedent: no ctx, no DOM, importable by the
   acceptance runner).

   Policy: refit content to the stage on the first paint, or when the action
   is one of reveal/hide/foldAll — the verbs that change which content is on
   screen. Every other repaint, crucially toggleExpand, returns the prior
   transform untouched: folding or unfolding a group moves neither zoom nor
   pan. When it does refit: k is the largest scale that fits both axes,
   clamped to [0.15, 1.15] (a floor so content never vanishes, a ceiling so a
   refit never zooms past readable); x centres; y centres too but never rides
   above pad. */

const REFIT_VERBS = new Set(['reveal', 'hide', 'foldAll']);

export function ufFitXform(args: {
  action: string;
  firstPaint: boolean;
  prev: { x: number; y: number; k: number };
  content: { width: number; height: number };
  stage: { width: number; height: number };
  pad: number;
}): { x: number; y: number; k: number } {
  const { action, firstPaint, prev, content, stage, pad } = args;
  if (!firstPaint && !REFIT_VERBS.has(action)) return prev;
  const k = Math.max(
    .15,
    Math.min(1.15, Math.min((stage.width - pad * 2) / content.width, (stage.height - pad * 2) / content.height)),
  );
  const x = (stage.width - content.width * k) / 2;
  const y = Math.max(pad, (stage.height - content.height * k) / 2);
  return { x, y, k };
}
