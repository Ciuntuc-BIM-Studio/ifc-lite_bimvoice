/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Studio's free solids as native elements: their history (`NativeSolidShape`)
 * travels with the model in `Pset_LapinSolid` (JSON in `Spec`, written by
 * the Studio builders), so a solid is recognized wherever its IFC goes, is
 * rebuilt from it (`solidStoreParams`), and has its quantities from it.
 */

import { RelationshipType } from '@ifc-lite/data';
import type { EffectiveEntityRecord } from '@ifc-lite/parser';
import { revolveFaces, sweepFaces } from '../in-store/sweep-revolve.js';
import type { ExtrusionInStoreParams } from '../in-store/extrusion.js';
import type { FacetedInStoreParams } from '../in-store/faceted.js';
import { NATIVE_SOLID_PSET } from './ifc-mapping.js';
import { liftBase, type LiftContext } from './lift-base.js';
import { RelationLookup } from './relation-lookup.js';
import type { NativeSolid, NativeSolidShape, PlanPoint } from './schema.js';
import { solidShapeProblems } from './validate.js';

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

/** The classes Studio builds a solid as (`drafting/commands/model.ts`). */
const STUDIO_CLASSES = [
  'IFCBUILDINGELEMENTPROXY', 'IFCFURNISHINGELEMENT', 'IFCFURNITURE', 'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN',
  'IFCMEMBER', 'IFCPLATE', 'IFCCOVERING', 'IFCROOF', 'IFCFOOTING', 'IFCSTAIR', 'IFCRAILING', 'IFCRAMP', 'IFCCHIMNEY',
];

/** A solid's history from its `Spec` value (JSON), or null when it is not one. */
export function readSolidShape(spec: unknown): NativeSolidShape | null {
  if (typeof spec !== 'string') return null;
  try {
    const shape = JSON.parse(spec) as NativeSolidShape;
    return solidShapeProblems(shape).length === 0 ? shape : null;
  } catch {
    return null;
  }
}

/** The `Pset_LapinSolid.Spec` value of `expressId`: the session's set, else the file's. */
function solidSpec(ctx: LiftContext, psets: RelationLookup, expressId: number): unknown {
  const own = ctx.view.getForEntity(expressId).find((s) => s.name === NATIVE_SOLID_PSET);
  if (own) return own.properties.find((p) => p.name === 'Spec')?.value;
  for (const setId of psets.get(expressId) ?? []) {
    const set = ctx.reader.entity(setId);
    if (set?.attributes[2] !== NATIVE_SOLID_PSET || !Array.isArray(set.attributes[4])) continue;
    for (const member of set.attributes[4] as unknown[]) {
      const p = ctx.reader.entity(refId(member) ?? -1);
      if (p?.attributes[0] !== 'Spec') continue;
      const v = p.attributes[2];
      return Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
    }
  }
  return undefined;
}

const DEFINES: ConstructorParameters<typeof RelationLookup>[3] = {
  type: 'IFCRELDEFINESBYPROPERTIES', edge: RelationshipType.DefinesByProperties, direction: 'inverse',
  pairs: (rel: EffectiveEntityRecord) => {
    const set = refId(rel.attributes[5]);
    const objects = Array.isArray(rel.attributes[4]) ? rel.attributes[4] : [];
    return set === null ? [] : objects.map(refId).filter((id): id is number => id !== null).map((id) => [id, set] as [number, number]);
  },
};

/** Lift `expressId` as a Studio solid, when it carries its history; null otherwise. */
export function liftSolid(ctx: LiftContext, expressId: number, psets = new RelationLookup(ctx.store, ctx.view, ctx.reader, DEFINES)): NativeSolid | null {
  const shape = readSolidShape(solidSpec(ctx, psets, expressId));
  if (!shape) return null;
  const skipped = ctx.skipped.length;
  const base = liftBase(ctx, expressId, 'solid');
  if (!base) return null;
  ctx.skipped.length = skipped;
  const entity = ctx.reader.entity(expressId)!;
  return { ...base, kind: 'solid', ifcClass: entity.type, shape };
}

/** Every element Studio built that the class lifters did not take: lifted as a solid (its earlier skip dropped). */
export function liftSolids(ctx: LiftContext): void {
  const psets = new RelationLookup(ctx.store, ctx.view, ctx.reader, DEFINES);
  for (const type of STUDIO_CLASSES) {
    for (const id of ctx.reader.ids(type)) {
      if (ctx.lifted.has(id)) continue;
      const solid = liftSolid(ctx, id, psets);
      if (!solid) continue;
      ctx.lifted.set(id, solid);
      ctx.skipped = ctx.skipped.filter((s) => s.expressId !== id);
    }
  }
}

type V3 = [number, number, number];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A sweep's or revolve's closed shell, storey frame. */
export function solidFaces(shape: Exclude<NativeSolidShape, { operation: 'extrude' }>): V3[][] {
  if (shape.operation === 'sweep') return sweepFaces(shape.profile, shape.path, { closed: shape.closed });
  return revolveFaces(shape.profile, shape.origin, shape.direction, shape.angle);
}

/** How a solid is written to IFC: an extrusion, or a faceted shell (the Studio builders' own params). */
export function solidStoreParams(e: NativeSolid):
  | { kind: 'extrusion'; params: ExtrusionInStoreParams }
  | { kind: 'faceted'; params: FacetedInStoreParams } {
  const s = e.shape;
  const naming = { IfcClass: e.ifcClass, ...(e.name ? { Name: e.name } : {}), ...(e.predefinedType ? { PredefinedType: e.predefinedType } : {}) };
  if (s.operation === 'extrude') {
    return { kind: 'extrusion', params: { ...naming, Outer: s.outer, ...(s.holes?.length ? { Holes: s.holes } : {}), Depth: s.depth, Location: s.location, Axis: s.axis, RefDirection: s.refDirection } };
  }
  return { kind: 'faceted', params: { ...naming, Faces: solidFaces(s), Location: [0, 0, 0] } };
}

const ringArea = (r: readonly PlanPoint[]) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const ringPerimeter = (r: readonly PlanPoint[]) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);

/** A solid's net volume (m³) and outer surface (m²): closed forms for an extrusion, the shell's for a sweep or revolve. */
export function solidMeasures(shape: NativeSolidShape): { volume: number; surface: number } {
  if (shape.operation === 'extrude') {
    const holes = shape.holes ?? [];
    const area = Math.max(0, ringArea(shape.outer) - holes.reduce((a, h) => a + ringArea(h), 0));
    const perimeter = ringPerimeter(shape.outer) + holes.reduce((a, h) => a + ringPerimeter(h), 0);
    return { volume: area * shape.depth, surface: 2 * area + perimeter * shape.depth };
  }
  let volume = 0, surface = 0;
  for (const face of solidFaces(shape)) {
    // Newell's normal: twice the face's vector area; the divergence theorem gives the volume.
    const n: V3 = [0, 0, 0];
    for (let i = 0; i < face.length; i++) {
      const c = cross(face[i], face[(i + 1) % face.length]);
      n[0] += c[0]; n[1] += c[1]; n[2] += c[2];
    }
    surface += Math.hypot(...n) / 2;
    volume += dot(face[0], n) / 6;
  }
  return { volume: Math.abs(volume), surface };
}

