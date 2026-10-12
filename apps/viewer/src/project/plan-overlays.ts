/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a floor plan draws over its cut besides drafted entities, grouped by
 * pen — layer, paper weight, line type — so a sheet viewport and the DXF
 * export put each on its own pen: the door and window symbols (thin lines,
 * a configured type's cut parts heavy, its exterior-seen parts dashed) and
 * the roof systems (ridges heavy; hips, eaves and verges seen; valleys
 * dashed; a downslope arrow with the pitch on every plane) and the road
 * corridors (`civil/civil-plan.ts`) and the section marks (`section-marks.ts`).
 * Honours the view's hidden categories.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { DraftShape, Pt } from '@/drafting/types';
import { PEN } from '@/components/viewer/sheets/viewport-pens';
import type { ProjectView } from './types';
import { planRoofs } from './roof-plan';
import { viewElevationSymbols, viewOpeningSymbols, visibleEntities } from './view-symbols';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { corridorOverlays } from '@/civil/civil-plan';
import { sectionMarkOverlays } from './section-marks';
import { useProjectStore } from './project-store';

export interface PlanOverlay {
  /** The DXF layer. */
  layer: string;
  /** Paper millimetres. */
  width: number;
  dashed?: boolean;
  shapes: DraftShape[];
  /** Labels, drawing coordinates, drawn horizontally in a small paper size. */
  texts?: { at: Pt; text: string }[];
}

const ROOF_PEN: Record<string, { width: number; dashed?: boolean }> = {
  ridge: { width: PEN.cut }, hip: { width: PEN.seen }, valley: { width: PEN.seen, dashed: true }, eave: { width: PEN.seen }, verge: { width: PEN.seen },
};

/** The roofs of a plan as overlays (none when the view hides roofs). */
export function roofOverlays(view: ProjectView, plane: SectionPlaneConfig, hidden: ReadonlySet<string>): PlanOverlay[] {
  if (view.kind !== 'plan' || hidden.has('IFCROOF')) return [];
  const byPen = new Map<string, PlanOverlay>();
  const pen = (key: string, width: number, dashed?: boolean) => {
    let o = byPen.get(key);
    if (!o) byPen.set(key, (o = { layer: 'ROOF', width, dashed, shapes: [], texts: [] }));
    return o;
  };
  for (const roof of planRoofs(view, plane)) {
    for (const l of roof.lines) {
      const p = ROOF_PEN[l.kind] ?? ROOF_PEN.eave;
      pen(`${p.width}:${p.dashed ? 1 : 0}`, p.width, p.dashed).shapes.push({ type: 'line', a: l.a, b: l.b });
    }
    const arrows = pen('arrows', PEN.hatch);
    for (const a of roof.arrows) {
      const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, head = Math.min(0.25, len / 3);
      arrows.shapes.push(
        { type: 'line', a: a.from, b: a.to },
        { type: 'line', a: a.to, b: { x: a.to.x - head * (ux * 0.92 - uy * 0.38), y: a.to.y - head * (uy * 0.92 + ux * 0.38) } },
        { type: 'line', a: a.to, b: { x: a.to.x - head * (ux * 0.92 + uy * 0.38), y: a.to.y - head * (uy * 0.92 - ux * 0.38) } },
      );
      arrows.texts!.push({ at: { x: (a.from.x + a.to.x) / 2 - uy * 0.3, y: (a.from.y + a.to.y) / 2 + ux * 0.3 }, text: `${a.pitch}°` });
    }
  }
  return [...byPen.values()].filter((o) => o.shapes.length);
}

/** The door and window symbols of a plan (or, given its drawing, an elevation / section) as overlays, by weight. */
export function symbolOverlays(
  meshes: readonly MeshData[], plane: SectionPlaneConfig, flips: Record<string, number> | undefined, hidden: ReadonlySet<string>, drawing?: Drawing2D | null,
): PlanOverlay[] {
  const thin: DraftShape[] = [], heavy: DraftShape[] = [], dashed: DraftShape[] = [];
  const symbols = plane.axis === 'y' ? viewOpeningSymbols(meshes, plane, flips, hidden) : viewElevationSymbols(meshes, plane, visibleEntities(drawing), hidden);
  for (const s of symbols) {
    thin.push(...s.shapes);
    if (s.heavy) heavy.push(...s.heavy);
    if (s.dashed) dashed.push(...s.dashed);
  }
  return [
    { layer: 'SYMBOLS', width: PEN.hatch, shapes: thin },
    { layer: 'SYMBOLS', width: PEN.cut, shapes: heavy },
    { layer: 'SYMBOLS', width: PEN.hatch, dashed: true, shapes: dashed },
  ].filter((o) => o.shapes.length);
}

/** Everything a plan view overlays: its symbols and its roofs; an elevation or section, its door and window symbols. */
export function planOverlays(
  view: ProjectView, plane: SectionPlaneConfig, meshes: readonly MeshData[] | undefined, flips: Record<string, number> | undefined, hidden: ReadonlySet<string>,
  drawing?: Drawing2D | null,
): PlanOverlay[] {
  if (view.kind === 'elevation' || view.kind === 'section') return meshes && drawing ? symbolOverlays(meshes, plane, flips, hidden, drawing) : [];
  if (view.kind !== 'plan') return [];
  return [
    ...(meshes ? symbolOverlays(meshes, plane, flips, hidden) : []), ...roofOverlays(view, plane, hidden), ...corridorOverlays(view, plane, hidden),
    ...sectionMarkOverlays(view, plane, useProjectStore.getState().views),
  ];
}
