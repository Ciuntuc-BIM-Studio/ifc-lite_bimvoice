/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A view's work plane in world units — the same `SectionPlaneConfig` the
 * drawing generator writes into `drawing.config.plane` — computed straight
 * from the view, so a view has a work plane (and drafting maps to 3D) even
 * before, or without, any generated drawing: an empty new project's floor
 * plan is a horizontal work plane at its level.
 *
 * Plans: horizontal at level + cut height. Sections: their stored world
 * offset or custom plane (anchored like the generator anchors it).
 * Elevations: just inside the model bounds (needs bounds).
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { customPlaneCenter } from '@/store/slices/section-plane-center';
import { percentToWorld, sectionAxisRange, type AxisBounds } from '@/lib/section/section-distance';
import { resolvePlanLevel } from './view-defaults';
import { sectionPlaneForView } from './view-plane';
import type { ProjectLevel, ProjectView } from './types';

const AXIS = { down: 'y', front: 'z', side: 'x' } as const;

/**
 * The plane drafting and modeling happen on: a floor plan's LEVEL (its
 * floor), not its cut plane — a slab drawn on a plan starts at the floor —
 * and a section / elevation's own plane. Drawing coordinates are the same
 * on both (only the plan plane's height differs).
 */
export function viewWorkPlane(view: ProjectView, drawingPlane: SectionPlaneConfig | null, levels: readonly ProjectLevel[]): SectionPlaneConfig | null {
  if (view.kind !== 'plan') return drawingPlane;
  const level = resolvePlanLevel(view, levels) ?? view.level;
  return { axis: 'y', position: level.elevation, flipped: false };
}

export function viewPlaneConfig(view: ProjectView, levels: readonly ProjectLevel[], bounds: AxisBounds | null): SectionPlaneConfig | null {
  switch (view.kind) {
    case 'plan': {
      const level = resolvePlanLevel(view, levels) ?? view.level;
      return { axis: 'y', position: level.elevation + view.cutHeight, flipped: false };
    }
    case 'section': {
      const { axis, offset, flipped, custom } = view.plane;
      const config: SectionPlaneConfig = { axis: AXIS[axis], position: offset, flipped };
      if (!custom) return config;
      const origin = customPlaneCenter(custom);
      return {
        ...config,
        customPlane: {
          normal: { x: custom.normal[0], y: custom.normal[1], z: custom.normal[2] },
          distance: custom.distance,
          origin: { x: origin[0], y: origin[1], z: origin[2] },
          tangent: { x: custom.tangent[0], y: custom.tangent[1], z: custom.tangent[2] },
          bitangent: { x: custom.bitangent[0], y: custom.bitangent[1], z: custom.bitangent[2] },
        },
      };
    }
    case 'elevation': {
      const plane = sectionPlaneForView(view, bounds, levels);
      const range = plane ? sectionAxisRange(bounds, plane.axis) : null;
      if (!plane || !range) return null;
      return { axis: AXIS[plane.axis], position: percentToWorld(plane.position, range), flipped: plane.flipped };
    }
    default:
      return null;
  }
}
