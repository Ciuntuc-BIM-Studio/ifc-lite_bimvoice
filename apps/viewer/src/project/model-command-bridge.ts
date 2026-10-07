/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The bridge between a floor-plan drawing tab and the modeling runtime
 * (`lib/commands/modeling`): the parametric BIM tools — wall, slab, column,
 * beam, door, window, opening, stair, railing, curtain wall, grid, room —
 * run on the plan's own drawing, the same commands (same gesture, ghost,
 * snaps, joins and undo step) the Model workspace's plan and the 3D view run.
 *
 * The runtime works in storey-local metres (its session workplane); the tab
 * draws in drawing coordinates on screen. The chain local → render
 * (`Workplane.localToRender`) → drawing (`worldToDrawing`) → screen
 * (`drawingToScreen`) is affine, so it is sampled at three points and
 * inverted exactly: pointer events go in through `toLocal`, the command's
 * plan layer and snap glyph come out through `toScreen`.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { CommandId, Workplane } from '@/lib/commands/modeling/types';
import type { Vec2 } from '@/lib/snap/types';
import { launchModelCommand } from '@/lib/commands/modeling/keys-workspace';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { drawingToScreen, worldToDrawing, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { cancelCommand as cancelDraftCommand } from '@/drafting/session';
import { isDrawingTabActive, useDocumentTabs } from './document-tabs';
import { resolveTarget } from './contour-element';
import { useProjectStore } from './project-store';
import type { ProjectView } from './types';

export interface LocalScreenMap {
  toScreen(local: Vec2): readonly [number, number];
  toLocal(screen: { x: number; y: number }): Vec2;
  metresPerPixel: number;
}

/** The affine map between workplane-local metres and the tab's screen; null when the workplane is edge-on to the view. */
export function localScreenMap(workplane: Pick<Workplane, 'localToRender'>, plane: SectionPlaneConfig, t: ViewTransform, axis: SectionAxisName): LocalScreenMap | null {
  const project = (u: number, v: number) => {
    const r = workplane.localToRender([u, v, 0]);
    return drawingToScreen(worldToDrawing(plane, { x: r[0], y: r[1], z: r[2] }), t, axis);
  };
  const o = project(0, 0);
  const ex = project(1, 0);
  const ey = project(0, 1);
  const a = ex.x - o.x, b = ey.x - o.x, c = ex.y - o.y, d = ey.y - o.y;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return {
    toScreen: (l) => [o.x + a * l[0] + b * l[1], o.y + c * l[0] + d * l[1]],
    toLocal: (s) => {
      const dx = s.x - o.x, dy = s.y - o.y;
      return [(d * dx - b * dy) / det, (a * dy - c * dx) / det];
    },
    metresPerPixel: 1 / t.scale,
  };
}

/** The drawing tab in front, when it is a project view. */
function frontView(): ProjectView | null {
  const tabs = useDocumentTabs.getState();
  if (!isDrawingTabActive(tabs)) return null;
  return useProjectStore.getState().views.find((v) => v.id === tabs.activeId) ?? null;
}

/**
 * Point the modeling session at `view`'s storey (its model's storey at the
 * plan's level). True when the session now draws on that storey.
 */
export function aimSessionAtPlan(view: ProjectView): boolean {
  if (view.kind !== 'plan') return false;
  const target = resolveTarget(view, view.level.elevation);
  if (!target) return false;
  const s = useViewerStore.getState();
  if (s.session?.modelId === target.modelId) {
    if (s.session.storeyId !== target.storeyId) s.setSessionStorey(target.storeyId);
    return true;
  }
  return s.enterModelWorkspace({ modelId: target.modelId, storeyId: target.storeyId });
}

/**
 * Start a BIM tool: on the floor plan in front, drawing on its storey; on
 * the 3D tab, as the Model workspace starts it. Sections and elevations
 * have no storey plane to draw on yet.
 */
export function startBimTool(id: CommandId): void {
  const view = frontView();
  if (view) {
    if (view.kind !== 'plan') {
      toast.info(resolve('drafting.msg.bimNeedsPlan'));
      return;
    }
    cancelDraftCommand();
    if (!aimSessionAtPlan(view)) {
      toast.info(resolve('drafting.msg.bimNoStorey'));
      return;
    }
  }
  launchModelCommand(id);
}
