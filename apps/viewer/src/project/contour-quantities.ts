/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The measures of a contour (an outline and its holes) — a face's, or the
 * profile an element is extruded from — and the base quantities they give
 * the extruded element: the IFC standard set of its class with that set's
 * own names (a slab's Qto_SlabBaseQuantities: Width, Perimeter, GrossArea,
 * NetArea, GrossVolume, NetVolume…). Which areas a profile stands for
 * depends on the view it was drawn in: drawn on a plan it is a wall's
 * footprint; on a section or elevation, its side.
 *
 * Gross counts the outline alone, net takes the holes out. Lengths are
 * metres here; the writer converts them to the model's length unit.
 */

import { signedArea } from '@/drafting/offset';
import type { Pt } from '@/drafting/types';

export interface ContourMeasures {
  /** The outline's area, m². */
  grossArea: number;
  /** Without the holes, m². */
  netArea: number;
  /** The outline's length, m. */
  outerPerimeter: number;
  /** Every edge, the holes' included, m. */
  perimeter: number;
  holes: number;
}

const length = (loop: readonly Pt[]) => loop.reduce((s, p, i) => s + Math.hypot(loop[(i + 1) % loop.length].x - p.x, loop[(i + 1) % loop.length].y - p.y), 0);

/** Outline first, holes after (as faces and extrusions keep them). */
export function contourMeasures(loops: readonly Pt[][]): ContourMeasures {
  const [outer, ...holes] = loops;
  if (!outer) return { grossArea: 0, netArea: 0, outerPerimeter: 0, perimeter: 0, holes: 0 };
  const grossArea = Math.abs(signedArea(outer));
  const holeArea = holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0);
  const outerPerimeter = length(outer);
  return {
    grossArea,
    netArea: Math.max(0, grossArea - holeArea),
    outerPerimeter,
    perimeter: outerPerimeter + holes.reduce((s, h) => s + length(h), 0),
    holes: holes.length,
  };
}

export type QuantityKind = 'LENGTH' | 'AREA' | 'VOLUME';

export interface ExtrusionQuantities {
  set: string;
  values: Array<{ name: string; value: number; kind: QuantityKind }>;
}

const L = (name: string, value: number) => ({ name, value, kind: 'LENGTH' as const });
const A = (name: string, value: number) => ({ name, value, kind: 'AREA' as const });
const V = (name: string, value: number) => ({ name, value, kind: 'VOLUME' as const });

/**
 * The base quantities of an element extruded `depth` metres from a profile
 * with measures `m`, drawn on a plan (`horizontal`) or on a section or
 * elevation.
 */
export function extrusionQuantities(ifcClass: string, horizontal: boolean, m: ContourMeasures, depth: number): ExtrusionQuantities {
  const d = Math.abs(depth);
  const volumes = [V('GrossVolume', m.grossArea * d), V('NetVolume', m.netArea * d)];
  const side = m.perimeter * d;
  const cls = ifcClass.toUpperCase().replace(/STANDARDCASE$|ELEMENTEDCASE$/, '');
  switch (cls) {
    case 'IFCSLAB':
      return { set: 'Qto_SlabBaseQuantities', values: [L('Width', d), L('Perimeter', m.outerPerimeter), A('GrossArea', m.grossArea), A('NetArea', m.netArea), ...volumes] };
    case 'IFCPLATE':
      return { set: 'Qto_PlateBaseQuantities', values: [L('Width', d), L('Perimeter', m.outerPerimeter), A('GrossArea', m.grossArea), A('NetArea', m.netArea), ...volumes] };
    case 'IFCWALL':
      return horizontal
        ? { set: 'Qto_WallBaseQuantities', values: [L('Height', d), A('GrossFootprintArea', m.grossArea), A('NetFootprintArea', m.netArea), ...volumes] }
        : { set: 'Qto_WallBaseQuantities', values: [L('Width', d), A('GrossSideArea', m.grossArea), A('NetSideArea', m.netArea), ...volumes] };
    case 'IFCCOLUMN':
      return { set: 'Qto_ColumnBaseQuantities', values: [L('Length', d), A('CrossSectionArea', m.netArea), A('OuterSurfaceArea', side), ...volumes] };
    case 'IFCBEAM':
      return { set: 'Qto_BeamBaseQuantities', values: [L('Length', d), A('CrossSectionArea', m.netArea), A('OuterSurfaceArea', side), ...volumes] };
    case 'IFCMEMBER':
      return { set: 'Qto_MemberBaseQuantities', values: [L('Length', d), A('CrossSectionArea', m.netArea), A('OuterSurfaceArea', side), ...volumes] };
    case 'IFCFOOTING':
      return { set: 'Qto_FootingBaseQuantities', values: [L('Length', d), A('CrossSectionArea', m.netArea), A('OuterSurfaceArea', 2 * m.netArea + side), ...volumes] };
    case 'IFCCOVERING':
      return { set: 'Qto_CoveringBaseQuantities', values: [L('Width', d), A('GrossArea', m.grossArea), A('NetArea', m.netArea)] };
    case 'IFCBUILDINGELEMENTPROXY':
      return { set: 'Qto_BuildingElementProxyQuantities', values: [A('NetSurfaceArea', 2 * m.netArea + side), V('NetVolume', m.netArea * d)] };
    default:
      // A class without a standard set that fits an extrusion: the same measures under Lapin's own set.
      return { set: 'IfcLite_ExtrusionQuantities', values: [L('Depth', d), L('Perimeter', m.outerPerimeter), A('GrossArea', m.grossArea), A('NetArea', m.netArea), A('SurfaceArea', 2 * m.netArea + side), ...volumes] };
  }
}
