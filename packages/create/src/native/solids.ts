/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Native elements as extruded solids for the Rust mesher (N2,
 * `meshNativeSolids`, `rust/geometry/src/native_solid.rs`): no STEP text.
 * The element's parameters are resolved here, with the same rules the IFC
 * writers apply, so both paths build the same body:
 *
 *  - a wall: its body outline after end cuts, offset and alignment
 *    (`wallBodyOutline`, as `addWallToStore`), placed at its start along its
 *    axis; the openings, doors and windows hosted in it are cut through it;
 *  - a slab: its outline with holes, hanging below its top; its openings cut;
 *  - a beam: its section on its axis, the section's X on the writer's
 *    reference direction; a column: its section standing on its base point.
 *
 * Coordinates are the storey frame (Z up from the storey elevation, metres).
 */

import type { ProfileSection } from '../in-store/profile.js';
import { wallBodyOutline } from '../in-store/wall-join.js';
import type { NativeElement, NativeId, PlanPoint } from './schema.js';
import { nativeSection, resolveNativeParam, type NativeIndex } from './validate.js';

export type SolidProfile =
  | { kind: 'polygon'; outer: PlanPoint[]; holes?: PlanPoint[][] }
  | { kind: 'section'; section: ProfileSection };

export interface NativeSolidSpec {
  profile: SolidProfile;
  /** Column-major 4x4: the profile frame (profile in XY, extruded along +Z) into the storey frame. */
  placement: number[];
  depth: number;
  /** Subtracted from this solid. */
  cuts?: NativeSolidSpec[];
}

/** How far a cut overshoots its host's faces, so no skin survives (as the IFC opening writer). */
const CUT_CLEARANCE = 0.05;

type Vec3 = [number, number, number];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Column-major matrix from an origin and the three axes. */
function frame(origin: Vec3, x: Vec3, y: Vec3, z: Vec3): number[] {
  return [...x, 0, ...y, 0, ...z, 0, ...origin, 1];
}
const planFrame = (origin: Vec3, angle: number) =>
  frame(origin, [Math.cos(angle), Math.sin(angle), 0], [-Math.sin(angle), Math.cos(angle), 0], [0, 0, 1]);

const num = (element: NativeElement, key: string, index: NativeIndex): number => {
  const v = resolveNativeParam(element, key, index);
  return typeof v === 'number' ? v : 0;
};

/** A box cut: a plan rectangle in `host`'s frame, from `z0` up by `height`. */
function boxCut(hostPlacement: number[], x0: number, x1: number, y0: number, y1: number, z0: number, height: number): NativeSolidSpec {
  return {
    profile: { kind: 'polygon', outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] },
    placement: multiply(hostPlacement, frame([0, 0, z0], [1, 0, 0], [0, 1, 0], [0, 0, 1])),
    depth: height,
  };
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** The solids of `element`; `hosted` lists the elements whose host it may be. */
export function nativeElementSolids(element: NativeElement, index: NativeIndex, hosted: readonly NativeElement[] = []): NativeSolidSpec[] {
  switch (element.kind) {
    case 'wall': {
      const outline = wallBodyOutline({
        start: element.start, end: element.end, thickness: num(element, 'thickness', index),
        alignment: element.alignment, offset: element.offset, startCut: element.startCut, endCut: element.endCut,
      });
      const angle = Math.atan2(element.end[1] - element.start[1], element.end[0] - element.start[0]);
      const placement = planFrame([element.start[0], element.start[1], num(element, 'baseOffset', index)], angle);
      const cuts: NativeSolidSpec[] = [];
      const [y0, y1] = [outline.yMin - CUT_CLEARANCE, outline.yMax + CUT_CLEARANCE];
      for (const h of hosted) {
        if ((h.kind === 'opening' && h.host === 'wall') && h.hostId === element.id) {
          cuts.push(boxCut(placement, h.along - h.width / 2, h.along + h.width / 2, y0, y1, num(h, 'sill', index), h.height));
        } else if ((h.kind === 'door' || h.kind === 'window') && h.hostId === element.id) {
          const type = h.typeId ? index.type(h.typeId) : undefined;
          if (type?.kind !== h.kind) continue;
          cuts.push(boxCut(placement, h.along - type.spec.width / 2, h.along + type.spec.width / 2, y0, y1, num(h, 'sill', index), type.spec.height));
        }
      }
      return [{ profile: { kind: 'polygon', outer: outline.corners.map(([x, y]) => [x, y] as PlanPoint) }, placement, depth: num(element, 'height', index), ...(cuts.length ? { cuts } : {}) }];
    }
    case 'slab': {
      const thickness = num(element, 'thickness', index);
      const base = num(element, 'topOffset', index) - thickness;
      const placement = frame([0, 0, base], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
      const cuts: NativeSolidSpec[] = [];
      for (const h of hosted) {
        if (h.kind !== 'opening' || h.host !== 'slab' || h.hostId !== element.id) continue;
        const turn = num(h, 'rotation', index);
        const at = planFrame([h.center[0], h.center[1], base - CUT_CLEARANCE], turn);
        cuts.push(boxCut(at, -h.width / 2, h.width / 2, -h.depth / 2, h.depth / 2, 0, thickness + 2 * CUT_CLEARANCE));
      }
      return [{
        profile: { kind: 'polygon', outer: element.outline, ...(element.holes?.length ? { holes: element.holes } : {}) },
        placement, depth: thickness, ...(cuts.length ? { cuts } : {}),
      }];
    }
    case 'beam': {
      const axis = norm([element.end[0] - element.start[0], element.end[1] - element.start[1], element.end[2] - element.start[2]]);
      // The writer's reference direction (`addBeamToStore`), turned by the rotation about the axis.
      const up: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const ref = norm(cross(up, axis));
      const side = cross(axis, ref);
      const t = num(element, 'rotation', index);
      const x: Vec3 = [0, 1, 2].map((i) => Math.cos(t) * ref[i] + Math.sin(t) * side[i]) as Vec3;
      const y = cross(axis, x);
      const length = Math.hypot(element.end[0] - element.start[0], element.end[1] - element.start[1], element.end[2] - element.start[2]);
      return [{ profile: { kind: 'section', section: nativeSection(element, index)! }, placement: frame(element.start, x, y, axis), depth: length }];
    }
    case 'column':
      return [{
        profile: { kind: 'section', section: nativeSection(element, index)! },
        placement: planFrame(element.position, num(element, 'rotation', index)),
        depth: num(element, 'height', index),
      }];
    default:
      // Openings, doors and windows are cut into their host; a door's or
      // window's own body is its joinery type's (mapped) geometry, meshed by
      // the IFC path until the joinery mesher moves here.
      return [];
  }
}

/** Every element's solids, keyed by element id; hosted elements are found in `elements`. */
export function nativeModelSolids(elements: readonly NativeElement[], index: NativeIndex): Map<NativeId, NativeSolidSpec[]> {
  const out = new Map<NativeId, NativeSolidSpec[]>();
  for (const element of elements) {
    const solids = nativeElementSolids(element, index, elements);
    if (solids.length) out.set(element.id, solids);
  }
  return out;
}

/** Section codes and dimension order of the wire format (IFC attribute order after Position). */
const SECTIONS: Record<ProfileSection['Type'], { code: number; dims: string[] }> = {
  Rectangle: { code: 1, dims: ['XDim', 'YDim'] },
  I: { code: 2, dims: ['OverallWidth', 'OverallDepth', 'WebThickness', 'FlangeThickness', 'FilletRadius'] },
  L: { code: 3, dims: ['Depth', 'Width', 'Thickness', 'FilletRadius'] },
  T: { code: 4, dims: ['Depth', 'FlangeWidth', 'WebThickness', 'FlangeThickness', 'FilletRadius'] },
  U: { code: 5, dims: ['Depth', 'FlangeWidth', 'WebThickness', 'FlangeThickness', 'FilletRadius'] },
  C: { code: 6, dims: ['Depth', 'Width', 'WallThickness', 'Girth', 'InternalFilletRadius'] },
  Circle: { code: 7, dims: ['Radius'] },
  RectangleHollow: { code: 8, dims: ['XDim', 'YDim', 'WallThickness', 'InnerFilletRadius', 'OuterFilletRadius'] },
  CircleHollow: { code: 9, dims: ['Radius', 'WallThickness'] },
};

function encodeSolid(out: number[], solid: NativeSolidSpec, withCuts: boolean): void {
  const p = solid.profile;
  if (p.kind === 'polygon') {
    out.push(0, p.outer.length, ...p.outer.flat(), p.holes?.length ?? 0);
    for (const hole of p.holes ?? []) out.push(hole.length, ...hole.flat());
  } else {
    const spec = SECTIONS[p.section.Type];
    const dims = p.section as unknown as Record<string, number | undefined>;
    out.push(spec.code, spec.dims.length, ...spec.dims.map((d) => dims[d] ?? Number.NaN));
  }
  out.push(...solid.placement, solid.depth);
  if (withCuts) {
    out.push(solid.cuts?.length ?? 0);
    for (const cut of solid.cuts ?? []) encodeSolid(out, cut, false);
  }
}

/** The wire buffer of `meshNativeSolids` for `solids`, in order. */
export function encodeNativeSolids(solids: readonly NativeSolidSpec[]): Float64Array {
  const out: number[] = [solids.length];
  for (const solid of solids) encodeSolid(out, solid, true);
  return Float64Array.from(out);
}
