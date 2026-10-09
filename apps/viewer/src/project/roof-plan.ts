/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The roof systems a floor plan shows — those on the plan's own storey —
 * with their geometry (`roofGeometry`) mapped to the plan's drawing
 * coordinates: outline edges, ridge / hip / valley / eave / verge lines and,
 * per plane, its downslope arrow and pitch.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { readRoofSystem, roofGeometry, type RoofGeometry, type RoofSystemSpec } from '@ifc-lite/create';
import { iterateEffectiveEntityIds } from '@ifc-lite/mutations';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { buildStoreyWorkplane } from '@/lib/commands/modeling/workplane';
import { worldToDrawing } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import type { ProjectView } from './types';

export interface PlanRoofArrow {
  /** From the plane's middle, downslope. */
  from: Pt;
  to: Pt;
  pitch: number;
}

export interface PlanRoof {
  modelId: string;
  roofId: number;
  spec: RoofSystemSpec;
  geometry: RoofGeometry;
  /** The wall-plate outline, drawing coordinates; edge i runs from point i to i + 1. */
  outline: Pt[];
  lines: { kind: RoofGeometry['lines'][number]['kind']; a: Pt; b: Pt }[];
  arrows: PlanRoofArrow[];
}

export function planRoofs(view: ProjectView, plane: SectionPlaneConfig): PlanRoof[] {
  if (view.kind !== 'plan') return [];
  const s = useViewerStore.getState();
  const wanted = new Set(view.level.storeyGlobalIds);
  const out: PlanRoof[] = [];
  for (const [modelId, model] of s.models) {
    const dataStore = model.ifcDataStore;
    const hierarchy = dataStore?.spatialHierarchy;
    if (!dataStore || !hierarchy) continue;
    const mv = s.mutationViews.get(modelId) ?? null;
    for (const { expressId: roofId } of iterateEffectiveEntityIds(dataStore, mv, ['IFCROOF'])) {
      const storeyId = hierarchy.elementToStorey.get(roofId);
      if (storeyId === undefined || (wanted.size && !wanted.has(dataStore.entities.getGlobalId(storeyId) ?? ''))) continue;
      let spec: RoofSystemSpec | null = null;
      let geometry: RoofGeometry;
      try {
        spec = readRoofSystem(dataStore, roofId, mv);
        if (!spec) continue;
        geometry = roofGeometry(spec.outline, spec.rules);
      } catch {
        continue;
      }
      const workplane = buildStoreyWorkplane(s, modelId, storeyId, 0);
      if ('refused' in workplane) continue;
      const lift = spec.eaveHeight;
      const at = (x: number, y: number, z = 0): Pt => {
        const r = workplane.localToRender([x, y, z + lift]);
        return worldToDrawing(plane, { x: r[0], y: r[1], z: r[2] });
      };
      const arrows = geometry.planes.map((p) => {
        const c = p.pts.reduce((acc, q) => [acc[0] + q[0] / p.pts.length, acc[1] + q[1] / p.pts.length], [0, 0]);
        const n = geometry.outline.length;
        const a = geometry.outline[p.edge], b = geometry.outline[(p.edge + 1) % n];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Downslope: towards the eave, the edge's outward normal.
        const down: [number, number] = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
        const len = 0.9;
        return { from: at(c[0] - down[0] * len / 2, c[1] - down[1] * len / 2), to: at(c[0] + down[0] * len / 2, c[1] + down[1] * len / 2), pitch: p.pitch };
      });
      out.push({
        modelId, roofId, spec, geometry,
        outline: geometry.outline.map(([x, y]) => at(x, y)),
        lines: geometry.lines.map((l) => ({ kind: l.kind, a: at(l.a[0], l.a[1], l.a[2]), b: at(l.b[0], l.b[1], l.b[2]) })),
        arrows,
      });
    }
  }
  return out;
}

/** The roof (renderer id) whose outline contains drawing point `p` on this plan, or null — what a click inside a roof selects. */
export function roofAtPoint(view: ProjectView, plane: SectionPlaneConfig, p: Pt): number | null {
  const s = useViewerStore.getState();
  for (const roof of planRoofs(view, plane)) {
    let inside = false;
    const o = roof.outline;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      if ((o[i].y > p.y) !== (o[j].y > p.y) && p.x < ((o[j].x - o[i].x) * (p.y - o[i].y)) / (o[j].y - o[i].y) + o[i].x) inside = !inside;
    }
    if (inside) return toGlobalIdFromModels(s.models, roof.modelId, roof.roofId);
  }
  return null;
}
