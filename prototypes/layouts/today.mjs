// Baseline: the real, current on-canvas positions straight from the live model.
// This is what the editor shows today — the reference every candidate must beat.
export const title = 'Today (current editor)';
export const principle = 'Top-down linear stack — the real stored layout. Reference point.';
export function layout(nodes /*, edges */) {
  const out = {};
  for (const n of nodes) out[n.id] = { x: n.x, y: n.y };
  return out;
}
