/* =====================================================================
   layout.ts — automatic layered-tree layout
   ---------------------------------------------------------------------
   Responsibility: the "Tidy" auto-layout. Pipeline per press:
     1. capture group membership (structural parent, geometry fallback)
     2. split spine nodes (endpoints of solid/thick edges + declared roots)
        from satellites (everything else); only the spine is layered
     3. find back-edges (DFS) on spine edges so cycles do not collapse layering
     4. layer the forward spine graph via longest-path (Kahn); declared
        `%% root` nodes are forced to layer 0
     5. order each layer by barycenter to reduce edge crossings
     6. position spine nodes by their rendered footprint (box + frontmatter
        card) along the flow direction (state.dir: TD/BT/LR/RL)
     7. park each satellite beside the spine node it references
     8. resize each group box to wrap its captured members

   Edge roles: solid/thick edges are structural (drive the tree); dotted
   edges are references (drawn, but never move a node).

   Mutates node x/y (and group x/y/w/h) only, never a node's own w/h.
   Re-renders, syncs, pushes history, zoom-to-fits.

   The capture / ordering / placement phases live in sibling modules
   (layout-capture, layout-order, layout-place) to keep each file under the
   size cap; this file wires them into the pipeline.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { FlowDir } from '../core/types/types';
import { nodeFootprint } from '../core/state/state';
import { routeReferences } from '../render/avoidRouter';
import { captureGroups, resolveSpine } from './layout-capture';
import { layerSpine } from './layout-order';
import type { SpineLayers } from './layout-order';
import type { Footprint } from './layout-place';
import {
  inlineMixedGroupSatellites, positionSpineLayers, clusterCandidateGroups,
  placeSatellites, markReferenceEdgesOrtho, wrapGroups,
} from './layout-place';

export interface LayoutApi {
  autoLayout: () => Promise<void>;
}

/**
 * A node's on-canvas footprint in layout pixels (box + frontmatter card).
 * Sizes come from the model (state.measured, populated by render's measure
 * pass) via nodeFootprint — never read live from the DOM. The card hangs
 * below the node and is centred on it: width = max(box, card), height = box
 * + gap + card. Nodes not currently rendered (off-level) have no measured
 * card, so they fall back to the box — exactly as the old DOM query did when
 * the element wasn't present.
 */
function footprint(ctx: AppContext, id: string): Footprint {
  const { state } = ctx;
  const node = state.nodes[id];
  const size = nodeFootprint(state, node, ctx.prefs.showFrontmatter);
  return { 'w': size.w, 'h': size.h };
}

/** Footprint of every node about to be laid out. */
function captureFootprints(ctx: AppContext, ids: string[]): Record<string, Footprint> {
  const foot: Record<string, Footprint> = {};
  ids.forEach((id) => {
    foot[id] = footprint(ctx, id);
  });
  return foot;
}

/** Re-render, sync, push history and zoom-to-fit once the layout is final. */
function finishLayout(ctx: AppContext, camera: CameraApi, dir: FlowDir): void {
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.pushHistory();
  camera.zoomToFit();
  ctx.hooks.toast('Tidied · ' + dir);
}

/** Group membership, spine/satellite split and per-node layer, ahead of any placement. */
interface LayoutPrep {
  groupMem: Record<string, string[]>;
  spine: Set<string>;
  spineLayers: SpineLayers;
  inlineSet: Set<string>;
}

/** Capture phase: group membership, spine resolution, layering and mixed-group inlining. */
function prepareSpine(ctx: AppContext, ids: string[]): LayoutPrep {
  const { state } = ctx;
  const groupMem = captureGroups(state);              // before anything moves
  const { spine, rootSet, spineIds } = resolveSpine(state, ids);
  const spineLayers = layerSpine(state, spineIds, spine, rootSet);
  const inlineSet = inlineMixedGroupSatellites(state, groupMem, spine, spineLayers);
  return { groupMem, spine, spineLayers, inlineSet };
}

/** Placement phase: position the spine, park satellites, wrap groups, route references. */
async function placeAndRoute(ctx: AppContext, ids: string[], prep: LayoutPrep): Promise<FlowDir> {
  const { state } = ctx;
  const foot = captureFootprints(ctx, ids);
  const dir: FlowDir = state.dir;
  const horizontal = positionSpineLayers(ctx, prep.spineLayers, foot, dir);

  const memberGroup = clusterCandidateGroups(prep.groupMem, prep.spine);
  const satellites = ids.filter((id) => !prep.spine.has(id) && !prep.inlineSet.has(id));
  placeSatellites(satellites, memberGroup, { ctx, spine: prep.spine, foot, horizontal });

  markReferenceEdgesOrtho(state);
  wrapGroups(ctx, prep.groupMem, foot);

  // obstacle-avoiding routes for reference edges (positions are final now)
  await routeReferences(ctx);
  return dir;
}

// Wires the auto-layout pipeline (see the module header) to a live context + camera.
export function initLayout(ctx: AppContext, camera: CameraApi): LayoutApi {
  const { state } = ctx;

  async function autoLayout(): Promise<void> {
    const ids = Object.keys(state.nodes).filter((id) => state.nodes[id].shape !== 'group');
    if (!ids.length) return;

    const prep = prepareSpine(ctx, ids);
    const dir = await placeAndRoute(ctx, ids, prep);
    finishLayout(ctx, camera, dir);
  }

  return { autoLayout };
}
