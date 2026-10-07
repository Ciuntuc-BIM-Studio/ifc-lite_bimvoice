/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where a project view puts the live section plane. Pure: given the merged
 * model bounds it returns the cardinal `{ axis, position %, flipped }` (or
 * custom plane) the existing Section / Drawing pipeline consumes, so every
 * view kind reaches the 2D drawing through the one contract
 * (`store/section-active.ts`) instead of a parallel path.
 *
 * Frame: the viewer is Y-up with `[x, z, -y]` from IFC, so viewer +Z is
 * IFC −Y (south) and +X is east. A cardinal cut keeps the half BELOW
 * `position` unless `flipped` (`projection-bands.ts` sign convention), i.e.
 * an unflipped cut is looked at from its + side.
 */

import { percentToWorld, sectionAxisRange, worldToPercent, type AxisBounds } from '@/lib/section/section-distance';
import type { SectionPlaneAxis } from '@/store/types';
import type { CustomSectionPlane } from '@/store/section-types';
import { resolvePlanLevel } from './view-defaults';
import type { ElevationDirection, ProjectLevel, ProjectView, SectionProjectPlane } from './types';

export interface ViewSectionPlane {
  axis: SectionPlaneAxis;
  /** 0..100 of the merged bounds along `axis`. */
  position: number;
  flipped: boolean;
  custom?: CustomSectionPlane;
}

const ELEVATION_PLANES: Record<ElevationDirection, { axis: SectionPlaneAxis; atMax: boolean; flipped: boolean }> = {
  // Viewer stands outside the named facade, looking at it.
  south: { axis: 'front', atMax: true, flipped: false },
  north: { axis: 'front', atMax: false, flipped: true },
  east: { axis: 'side', atMax: true, flipped: false },
  west: { axis: 'side', atMax: false, flipped: true },
};

/**
 * How far inside the model bounds an elevation's plane sits, metres. A plane
 * exactly ON the bounds is degenerate for the projection classifier (every
 * mesh touches it) and draws a scatter of fragments; just inside it, the
 * facade projects cleanly and nothing real is cut.
 */
export const ELEVATION_INSET_M = 0.05;

function elevationPlane(direction: ElevationDirection, bounds: AxisBounds | null): ViewSectionPlane {
  const { axis, atMax, flipped } = ELEVATION_PLANES[direction];
  const range = sectionAxisRange(bounds, axis);
  const inset = range ? Math.min(50, (ELEVATION_INSET_M / (range.max - range.min)) * 100) : 0.1;
  return { axis, position: atMax ? 100 - inset : inset, flipped };
}

/**
 * The section plane a view opens on, or `null` when it has none (3D views)
 * or cannot resolve (a plan whose level is not loaded, no bounds yet).
 */
export function sectionPlaneForView(
  view: ProjectView,
  bounds: AxisBounds | null,
  levels: readonly ProjectLevel[],
): ViewSectionPlane | null {
  switch (view.kind) {
    case 'elevation':
      return elevationPlane(view.direction, bounds);
    case 'plan': {
      const range = sectionAxisRange(bounds, 'down');
      const level = resolvePlanLevel(view, levels) ?? (levels.length === 0 ? view.level : undefined);
      if (!range || !level) return null;
      return { axis: 'down', position: worldToPercent(level.elevation + view.cutHeight, range), flipped: false };
    }
    case 'section': {
      const { axis, offset, flipped, custom } = view.plane;
      const range = sectionAxisRange(bounds, axis);
      if (!range) return null;
      const plane: ViewSectionPlane = { axis, position: worldToPercent(offset, range), flipped };
      return custom ? { ...plane, custom } : plane;
    }
    default:
      return null;
  }
}

/** Capture a live cardinal/custom section plane as a bounds-independent view plane. */
export function projectPlaneFromSection(
  plane: ViewSectionPlane,
  bounds: AxisBounds | null,
): SectionProjectPlane | null {
  const range = sectionAxisRange(bounds, plane.axis);
  if (!range) return null;
  const captured: SectionProjectPlane = { axis: plane.axis, offset: percentToWorld(plane.position, range), flipped: plane.flipped };
  return plane.custom ? { ...captured, custom: plane.custom } : captured;
}
