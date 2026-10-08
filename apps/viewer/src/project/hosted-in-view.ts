/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Doors, windows and openings placed on a section or elevation: click on a
 * wall's face and the filling goes into that wall there. The click is a
 * point on the view's plane; the line of sight through it is cut with the
 * wall's vertical axis plane (storey-local, as the plan's hosted commands
 * work), giving the offset along the wall and the height. A door stands on
 * the wall's base; a window or an opening is centred on the click height.
 * The fill goes through the same store action as the plan's door / window
 * tools (`addHostedFill`): one undo step, the host re-meshed with its void.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { useViewerStore } from '@/store';
import { buildStoreyWorkplane } from '@/lib/commands/modeling/workplane';
import { readHost, toHostLocal, fromHostLocal, type HostHit } from '@/lib/commands/modeling/commands/hosted-host';
import { authoringDim } from '@/store/slices/authoringDefaultsSlice';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { drawingToWorld, worldToDrawing, type Vec3 } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import type { HostedFillKind, HostedFillSpec } from '@/store/slices/mutation-hosted-fill';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { towardViewer } from './contour-element';

export interface HostedPlacement {
  modelId: string;
  host: HostHit;
  storeyId: number;
  offset: number;
  sill: number;
  width: number;
  height: number;
  /** The opening's outline on the drawing (preview). */
  outline: Pt[];
}

const OPENING = { Width: 1, Height: 1 };

function size(kind: HostedFillKind): { width: number; height: number } {
  const d = useViewerStore.getState().authoringDefaults;
  if (kind === 'opening') return { width: OPENING.Width, height: OPENING.Height };
  return { width: authoringDim(d, kind, 'Width'), height: authoringDim(d, kind, 'Height') };
}

/** Where a `kind` would go for a click at `p` on element `renderId`, or a reason it cannot. */
export function hostedPlacementAt(kind: HostedFillKind, renderId: number | null, p: Pt, plane: SectionPlaneConfig): HostedPlacement | string {
  if (renderId === null) return 'Click on a wall.';
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  if (!ref) return 'Click on a wall.';
  if (!modelEditTarget(s, ref.modelId)) return 'The model cannot be edited.';
  const host = readHost(useViewerStore.getState(), ref.modelId, ref.expressId);
  const storeyId = s.models.get(ref.modelId)?.ifcDataStore?.spatialHierarchy?.elementToStorey.get(ref.expressId);
  if (!host || storeyId === undefined) return 'Doors and windows go into walls: click on a wall.';
  const workplane = buildStoreyWorkplane(useViewerStore.getState(), ref.modelId, storeyId, 0);
  if ('refused' in workplane) return workplane.refused;
  const toLocal = (w: Vec3) => workplane.renderToLocal([w.x, w.y, w.z]);
  // The line of sight through the click, into the scene.
  const w = drawingToWorld(plane, p);
  const into = towardViewer(plane).map((v) => -v);
  const a = toLocal(w);
  const b = toLocal({ x: w.x + into[0], y: w.y + into[1], z: w.z + into[2] });
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = [-host.axisX[1], host.axisX[0]];
  const den = d[0] * n[0] + d[1] * n[1];
  const t = Math.abs(den) > 1e-9 ? -((a[0] - host.origin[0]) * n[0] + (a[1] - host.origin[1]) * n[1]) / den : 0;
  const hit = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
  const { width, height } = size(kind);
  const along = toHostLocal(host, [hit[0], hit[1]])[0];
  const lo = host.x[0] + width / 2, hi = host.x[1] - width / 2;
  if (lo > hi) return 'The wall is too short for it.';
  const offset = Math.min(hi, Math.max(lo, along));
  const z = hit[2] - host.origin[2];
  const top = host.z[1] - height;
  const sill = kind === 'door' ? Math.max(host.z[0], 0) : Math.min(top, Math.max(host.z[0], z - height / 2));
  if (sill + height > host.z[1] + 1e-6) return 'The wall is not high enough for it.';
  // The outline on the drawing: the opening's face on the wall's axis plane.
  const corner = (u: number, v: number): Pt => {
    const [x, y] = fromHostLocal(host, [u, 0]);
    const r = workplane.localToRender([x, y, host.origin[2] + v]);
    return worldToDrawing(plane, { x: r[0], y: r[1], z: r[2] });
  };
  const outline = [corner(offset - width / 2, sill), corner(offset + width / 2, sill), corner(offset + width / 2, sill + height), corner(offset - width / 2, sill + height)];
  return { modelId: ref.modelId, host, storeyId, offset, sill, width, height, outline };
}

/** Put the filling in; null on success, else why not. */
export function placeHosted(kind: HostedFillKind, at: HostedPlacement): string | null {
  const s = useViewerStore.getState();
  // Editing happens in the model workspace (as the plan's door / window tools do).
  if (!s.editEnabled && !s.enterModelWorkspace({ modelId: at.modelId, storeyId: at.storeyId })) return 'The model cannot be edited.';
  const d = useViewerStore.getState().authoringDefaults;
  const spec: HostedFillSpec = kind === 'opening'
    ? { kind, params: { Offset: at.offset, Sill: at.sill, Width: at.width, Height: at.height } }
    : { kind, params: { Offset: at.offset, Sill: at.sill, Width: at.width, Height: at.height, FrameThickness: authoringDim(d, kind, 'FrameThickness') } };
  const placed = useViewerStore.getState().addHostedFill(at.modelId, at.host.expressId, spec);
  if ('error' in placed) return placed.error;
  void requestRemesh(useViewerStore.getState, at.modelId, [placed.expressId, placed.openingId, at.host.expressId], 'created');
  return null;
}
