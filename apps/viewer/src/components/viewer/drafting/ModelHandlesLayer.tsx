/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The selected BIM element's grips on a floor-plan drawing tab — the Model
 * workspace plan's handles (`plan/plan-handles.ts`): a wall's two axis ends
 * (`wall.moveEndpoint`), a door's, window's or opening's slide along its wall
 * (`hosted.slide`), a move grip at the element's middle (`plan.move`) and,
 * for a wall, a flip grip beside it (a click flips the wall across its axis).
 *
 * They show for one selected element of an editable model on the plan's
 * storey, whatever the Edit mode: grabbing one switches Edit mode on, points
 * the modeling session at the plan's storey and starts the handle's command,
 * which the drag then feeds like any BIM tool running on the tab
 * (`useModelCommandBridge`). One drag is one undo step.
 */

import { useEffect, useMemo } from 'react';
import type { Drawing2D, SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { useCommandRuntime } from '@/lib/commands/modeling/runtime';
import { buildStoreyWorkplane, isWorkplane } from '@/lib/commands/modeling/workplane';
import type { Workplane } from '@/lib/commands/modeling/types';
import type { Vec2 } from '@/lib/snap/types';
import { beginPlanHandleDrag, clickPlanHandle } from '@/components/viewer/plan/PlanPointer';
import { PLAN_HANDLE_RADIUS_PX, PLAN_HANDLE_REACH_PX, selectedPlanHandles, type PlanHandle } from '@/components/viewer/plan/plan-handles';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { aimSessionAtPlan, localScreenMap, type LocalScreenMap } from '@/project/model-command-bridge';
import { resolveTarget } from '@/project/contour-element';
import { ensureEditMode } from '@/project/edit-mode';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import type { ProjectView } from '@/project/types';

interface Params {
  view: ProjectView;
  /** The view's work plane (a plan's level). */
  plane: SectionPlaneConfig | null;
  drawing: Drawing2D | null;
  transform: ViewTransform;
  axis: SectionAxisName;
  /** A drafting command runs: no grips. */
  drafting: boolean;
}

export interface ModelHandles {
  /** The grips, on screen. */
  shown: readonly { handle: PlanHandle; x: number; y: number }[];
  /** The plan's storey and the local ↔ screen map grips are placed with (null off a plan). */
  target: { modelId: string; storeyId: number } | null;
  map: LocalScreenMap | null;
  /** No grips now (a command runs, a drafting tool is out). */
  idle: boolean;
  /** A press at screen (x, y): grab the grip there and start its command. True when one was grabbed. */
  grab(x: number, y: number): boolean;
}

/** The middle of the selected element's cut outlines, drawing coordinates. */
function outlineCentre(drawing: Drawing2D | null, globalId: number): { x: number; y: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const polygon of drawing?.cutPolygons ?? []) {
    if (polygon.entityId !== globalId) continue;
    for (const p of polygon.polygon.outer) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
}

export function useModelHandles({ view, plane, drawing, transform, axis, drafting }: Params): ModelHandles {
  const selectedId = useViewerStore((s) => s.selectedEntityId);
  const selectedIds = useViewerStore((s) => s.selectedEntityIds);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const models = useViewerStore((s) => s.models);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const { command } = useCommandRuntime();

  // The plan's storey and its workplane: where the grips sit, and what a grabbed one edits.
  const target = useMemo(() => {
    void models; void mutationVersion;
    if (view.kind !== 'plan') return null;
    const found = resolveTarget(view, view.level.elevation);
    if (!found) return null;
    const workplane = buildStoreyWorkplane(useViewerStore.getState(), found.modelId, found.storeyId, 0);
    return isWorkplane(workplane) ? { ...found, workplane: workplane as Workplane } : null;
  }, [view, models, mutationVersion]);
  // A model nobody has edited yet has no mutation view, and without one a wall's axis cannot be read:
  // selecting on an editable model opens it, so the wall's end grips show at once.
  useEffect(() => {
    if (!target || selectedId === null || mutationViews.has(target.modelId)) return;
    const s = useViewerStore.getState();
    if (s.canCollabEdit()) modelEditTarget(s, target.modelId);
  }, [target, selectedId, mutationViews]);

  const map: LocalScreenMap | null = useMemo(
    () => (target && plane ? localScreenMap(target.workplane, plane, transform, axis) : null),
    [target, plane, transform, axis],
  );

  const handles = useMemo(() => {
    void selectedIds; void mutationVersion; void mutationViews;
    if (!target || !map || drafting || command || selectedId === null) return [];
    const s = useViewerStore.getState();
    if (!s.canCollabEdit()) return [];
    // As the plan of the Model workspace sees it once a grip is grabbed: the session on this storey, Select, editing.
    const session = { ...(s.session ?? {}), modelId: target.modelId, storeyId: target.storeyId } as NonNullable<typeof s.session>;
    const centre = outlineCentre(drawing, selectedId);
    const local = centre ? map.toLocal(drawingToScreen(centre, transform, axis)) : null;
    return selectedPlanHandles({ ...s, session, activeTool: 'select', editEnabled: true }, target.workplane, local as Vec2 | null);
  }, [target, map, drafting, command, selectedId, selectedIds, mutationVersion, mutationViews, drawing, transform, axis]);

  const shown = useMemo(() => (map ? handles.map((handle) => {
    const [x, y] = map.toScreen(handle.at);
    return { handle, x, y };
  }) : []), [handles, map]);

  const grab = (x: number, y: number): boolean => {
    let best: { handle: PlanHandle; d: number } | null = null;
    for (const h of shown) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= PLAN_HANDLE_REACH_PX && (!best || d < best.d)) best = { handle: h.handle, d };
    }
    if (!best || !ensureEditMode() || !aimSessionAtPlan(view)) return false;
    // A grip that acts on a click (flip) acts on the press.
    if (clickPlanHandle(best.handle)) return true;
    return beginPlanHandleDrag(best.handle);
  };

  return { shown, grab, target: target ? { modelId: target.modelId, storeyId: target.storeyId } : null, map, idle: drafting || command !== null };
}

export function ModelHandlesLayer({ handles }: { handles: ModelHandles }) {
  const { t } = useTranslation();
  if (handles.shown.length === 0) return null;
  const r = PLAN_HANDLE_RADIUS_PX;
  return (
    <svg data-bim-handles className="absolute inset-0 h-full w-full pointer-events-none">
      {handles.shown.map(({ handle, x, y }) => {
        const key = handle.kind === 'wallEnd' ? `end-${handle.which}` : handle.kind;
        const title = t(handle.kind === 'move' ? 'planHandles.handle.move' : handle.kind === 'wallEnd' ? 'planHandles.handle.wallEnd'
          : handle.kind === 'flip' ? 'planHandles.handle.flip' : 'planHandles.handle.slide');
        if (handle.kind === 'flip' && handles.map) {
          // The arrows across the wall, on screen.
          const [x1, y1] = handles.map.toScreen([handle.at[0] + handle.normal[0], handle.at[1] + handle.normal[1]]);
          const len = Math.hypot(x1 - x, y1 - y) || 1;
          const [nx, ny] = [(x1 - x) / len, (y1 - y) / len];
          const tip = (k: 1 | -1) => [x + k * nx * (r - 1.5), y + k * ny * (r - 1.5)];
          const head = (k: 1 | -1) => {
            const [tx, ty] = tip(k), bx = tx - k * nx * 3, by = ty - k * ny * 3;
            return `M${tx.toFixed(1)} ${ty.toFixed(1)}L${(bx - ny * 2.5).toFixed(1)} ${(by + nx * 2.5).toFixed(1)}L${(bx + ny * 2.5).toFixed(1)} ${(by - nx * 2.5).toFixed(1)}Z`;
          };
          const [ax, ay] = tip(-1), [bx, by] = tip(1);
          return (
            <g key={key} data-plan-handle={key}>
              <title>{title}</title>
              <circle cx={x} cy={y} r={r} fill="#ffffff" stroke="#2563eb" strokeWidth={2} />
              <path d={`M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`} stroke="#2563eb" strokeWidth={1.5} />
              <path d={head(1) + head(-1)} fill="#2563eb" />
            </g>
          );
        }
        return (
          <g key={key} data-plan-handle={key}>
            <title>{title}</title>
            {handle.kind === 'move'
              ? (
                <>
                  <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={2} fill="#ffffff" stroke="#2563eb" strokeWidth={2} />
                  <path d={`M${x - r + 3} ${y}H${x + r - 3}M${x} ${y - r + 3}V${y + r - 3}`} stroke="#2563eb" strokeWidth={1.5} />
                </>
              )
              : <circle cx={x} cy={y} r={r} fill="#ffffff" stroke="#2563eb" strokeWidth={2} />}
          </g>
        );
      })}
    </svg>
  );
}
