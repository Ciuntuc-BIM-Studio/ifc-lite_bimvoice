/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `wall.moveEndpoint` (charter #6232, WP2): drag one end of the selected
 * wall. While the pointer is down a ghost follows the (snapped) cursor: with
 * `?perf.nativeRemesh=1`, the moved walls themselves (joins, layers,
 * openings), built natively on a draft of the edit (`native-preview.ts`);
 * otherwise a plain box.
 * release writes ONE `resizeWall` — one transaction, one undo step — and the
 * command ends. Escape during the drag cancels with nothing written.
 *
 * The walls joined at the dragged end move along only when they are selected
 * too (the whole corner moves); a wall selected alone leaves the corner: the
 * join at that end is broken and the other wall stops square there.
 *
 * Started from the endpoint handles in the select tool
 * (`WallEndpointOverlay` → `beginWallEndpointDrag`). The handle unmounts as
 * the tool switches, so the drag is followed through the command pointer
 * (canvas moves) and a window `pointerup`, not pointer capture.
 */

import { useViewerStore } from '@/store';
import { authoringDim } from '@/store/slices/authoringDefaultsSlice';
import { resolveEntityRef } from '@/store/resolveEntityRef';
import { dist } from '@/lib/snap/constraints';
import type { Vec2 } from '@/lib/snap/types';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { resizeWallMetres } from '@/store/slices/mutation-wall-resize';
import { resizeWallInStore } from '@ifc-lite/create';
import type { MeshData } from '@ifc-lite/geometry';
import { endPreview, endPreviewAfterRemesh, previewEditNatively, schedulePreview } from '@/lib/remesh/native-preview';
import { commandGhostId, wallGhostMesh } from '../ghost.js';
import { commitCommand, getCommandRuntime, updateCommandGesture } from '../runtime.js';
import { buildStoreyWorkplane, elementStoreyId, isWorkplane } from '../workplane.js';
import type { CommandContext, ModelingCommand, Vec3, Workplane } from '../types.js';

export type WallEnd = 'start' | 'end';

export interface WallEndpointGesture {
  target: { modelId: string; expressId: number } | null;
  /** The wall's storey workplane; its ends are storey-local. */
  plane: Workplane | null;
  start: Vec3;
  end: Vec3;
  thickness: number;
  height: number;
  which: WallEnd | null;
  /** Where the dragged end is now, storey-local plan. */
  moving: Vec2 | null;
  /** The moved walls with their real geometry (native preview), when it could be built. */
  preview: MeshData[] | null;
  /** The selected elements of the wall's model: the walls joined at the dragged end that move along. */
  movesWith: readonly number[];
}

const EMPTY: WallEndpointGesture = {
  target: null, plane: null, start: [0, 0, 0], end: [0, 0, 0], thickness: 0, height: 0, which: null, moving: null, preview: null, movesWith: [],
};

/** The selected elements of `modelId`, express ids. */
function selectedIn(s: ReturnType<CommandContext['get']>, modelId: string): number[] {
  const ids = new Set(s.selectedEntityIds);
  if (s.selectedEntityId !== null) ids.add(s.selectedEntityId);
  return [...ids].map(resolveEntityRef).filter((ref) => ref.modelId === modelId).map((ref) => ref.expressId);
}

/** The gesture for the wall `globalId` (default: the selected one). */
function gestureFor(s: ReturnType<CommandContext['get']>, globalId: number | null): WallEndpointGesture {
  if (globalId === null) return EMPTY;
  const { modelId, expressId } = resolveEntityRef(globalId);
  const wall = s.models.has(modelId) ? s.readWallEndpoints(modelId, expressId) : null;
  const storeyId = elementStoreyId(s, modelId, expressId);
  if (!wall || storeyId === null) return EMPTY;
  const plane = buildStoreyWorkplane(s, modelId, storeyId, 0);
  return {
    ...EMPTY,
    target: { modelId, expressId },
    plane: isWorkplane(plane) ? plane : null,
    start: wall.start,
    end: wall.end,
    thickness: wall.thickness,
    height: Number.isFinite(wall.height) ? wall.height : authoringDim(s.authoringDefaults, 'wall', 'Height'),
    movesWith: selectedIn(s, modelId),
  };
}

const init = (ctx: CommandContext): WallEndpointGesture => gestureFor(ctx.get(), ctx.get().selectedEntityId);

/** How a moved end treats the walls joined there: the selected ones move along, the others let go. */
const joinedEnds = (g: WallEndpointGesture) => ({ moveJoinedEnds: true, movesWith: new Set(g.movesWith) });

type Point3 = [number, number, number];

function ends(g: WallEndpointGesture): { start: Point3; end: Point3 } | null {
  if (!g.which || !g.moving) return null;
  const moved: Point3 = [g.moving[0], g.moving[1], g[g.which][2]];
  const copy = (p: Vec3): Point3 => [p[0], p[1], p[2]];
  return g.which === 'start' ? { start: moved, end: copy(g.end) } : { start: copy(g.start), end: moved };
}

/** Build the moved walls' real geometry for `g` (the resize run on a draft, `native-preview.ts`). */
function previewMove(g: WallEndpointGesture): void {
  const next = ends(g);
  if (!g.target || !next) return;
  const { modelId, expressId } = g.target;
  schedulePreview(WALL_MOVE_ENDPOINT.id, () => previewEditNatively(modelId, (ctx) => {
    const result = resizeWallInStore(ctx, expressId, next.start, next.end, joinedEnds(g));
    return result.ok ? result.walls : [];
  }));
}

export const WALL_MOVE_ENDPOINT: ModelingCommand<WallEndpointGesture> = {
  id: 'wall.moveEndpoint',
  labelKey: 'modelingCommand.wallEnd.label',
  hud: { hint: () => 'modelingCommand.wallEnd.hint' },
  snap: 'modeling',
  init,
  snapQuery(g) {
    const fixed = g.which === 'start' ? g.end : g.start;
    return { anchor: g.which ? [fixed[0], fixed[1]] : null, chain: [], locks: {} };
  },
  pointerMove(g, s) {
    if (!g.which || !g.plane || !s.render) return g;
    const local = g.plane.renderToLocal(s.render);
    const moved: WallEndpointGesture = { ...g, moving: [local[0], local[1]] };
    previewMove(moved);
    return moved;
  },
  pointerDown: (g) => g,
  validate(g) {
    const next = ends(g);
    return next && dist([next.start[0], next.start[1]], [next.end[0], next.end[1]]) >= 0.01
      ? { ok: true } : { ok: false, reasonKey: 'modelingCommand.wall.tooShort' };
  },
  commit(g, tx) {
    const next = ends(g);
    if (!g.target || !next) throw new Error('No wall end to move');
    const { modelId, expressId } = g.target;
    const model = modelEditTarget(tx.store, modelId);
    if (!model) throw new Error(`No model loaded for id "${modelId}"`);
    // A dragged corner takes the selected walls joined to it along and lets go of the others;
    // every join that touches a moved wall is cut again. The transaction's batch id: undo / redo rebuild the meshes by it.
    const result = resizeWallMetres(tx.api, model, modelId, expressId, next.start, next.end, tx.batchId, joinedEnds(g));
    if (!result.ok) throw new Error(`Couldn't resize the wall: ${result.reason}`);
    // 'hostsChanged': the openings and fillings of every moved wall move with it.
    return { modelId, created: [], deleted: [], remesh: result.walls, remeshCause: 'hostsChanged', select: [expressId] };
  },
  afterCommit: (_g, result) => {
    // The real walls show again once their new geometry is in the scene.
    if (result?.modelId) endPreviewAfterRemesh(result.modelId);
    else endPreview();
    return { exit: true };
  },
  cancel: () => {
    endPreview();
    return 'exit';
  },
  ghost(g, ctx) {
    if (g.preview?.length) return g.preview;
    const next = ends(g);
    if (!g.plane || !next) return [];
    const mesh = wallGhostMesh(g.plane, [next.start[0], next.start[1]], [next.end[0], next.end[1]], g.thickness, g.height, commandGhostId(ctx.get()));
    return mesh ? [mesh] : [];
  },
};

/**
 * An endpoint handle was grabbed: run the command until the pointer is released.
 * `wallGlobalId`: the wall the handle is on, when several are selected (default: the selected one).
 */
export function beginWallEndpointDrag(which: WallEnd, wallGlobalId?: number): void {
  useViewerStore.getState().startCommand(WALL_MOVE_ENDPOINT.id);
  if (getCommandRuntime().command?.id !== WALL_MOVE_ENDPOINT.id) return;
  const s = useViewerStore.getState();
  updateCommandGesture((g) => ({ ...(wallGlobalId === undefined ? g as WallEndpointGesture : gestureFor(s, wallGlobalId)), which }));
  window.addEventListener('pointerup', () => {
    const runtime = getCommandRuntime();
    if (runtime.command?.id !== WALL_MOVE_ENDPOINT.id) return; // cancelled with Escape
    // A press without a drag writes nothing.
    if ((runtime.gesture as WallEndpointGesture).moving) commitCommand();
    if (getCommandRuntime().command?.id === WALL_MOVE_ENDPOINT.id) {
      useViewerStore.getState().endCommand('cancel');
      endPreview(); // not committed: the real walls were not replaced
    }
  }, { once: true });
}
