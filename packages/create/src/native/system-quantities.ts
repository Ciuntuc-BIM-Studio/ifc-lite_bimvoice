/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The base quantities of a native system (N3), from its family's spec: a
 * railing's length along its path, a roof's sloped and plan areas over its
 * planes (`roofGeometry`, overhangs included), a curtain wall's length,
 * height and face; a stair's run and volume from the stepped profile its
 * builder extrudes (`stairFlightOutline`); a truss's timber from the bars its
 * builder makes (`trussBars`), in a Lapin set (IFC4 has no standard one for
 * an element assembly); a corridor's length, pavement and, with the terrain
 * it daylights to (`SystemQuantityContext`), its cut and fill, from the
 * model its builder makes (`buildCorridor`), in a Lapin set too.
 */

import { QuantityType } from '@ifc-lite/data';
import { roofGeometry, type RoofEdgeRule } from '../in-store/roof-system.js';
import { stairFlightOutline } from '../in-store/stair.js';
import { trussBars, trussProblem, type TimberTrussSpec } from '../in-store/truss.js';
import { buildCorridor, type CorridorSpec } from '../civil/corridor.js';
import { padFootingProblems, padFootingQuantities, stripFoundationProblems, stripFoundationQuantities, type PadStep, type StripFoundationSpec } from '../in-store/foundation-spec.js';
import { Terrain } from '../civil/tin.js';
import type { NativeSystem } from './schema.js';
import type { SystemQuantityContext } from './system-terrain.js';

type V3 = readonly [number, number, number];
interface Quantity { name: string; value: number; quantityType: QuantityType }

const length = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Length });
const area = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Area });
const volume = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Volume });
const count = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Count });
const isPoint = (v: unknown, n: 2 | 3): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const points = <N extends 2 | 3>(v: unknown, n: N) => (Array.isArray(v) && v.every((p) => isPoint(p, n)) ? (v as number[][]) : null);
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

const isSection = (v: unknown) => !!v && typeof v === 'object' && positive((v as { width?: unknown }).width) !== null && positive((v as { depth?: unknown }).depth) !== null;
/** A truss spec as `trussBars` reads it. */
function isTrussSpec(v: Record<string, unknown>): v is Record<string, unknown> & TimberTrussSpec {
  return typeof v.shape === 'string' && typeof v.pattern === 'string' && positive(v.span) !== null && positive(v.rise) !== null
    && positive(v.panels) !== null && typeof v.overhang === 'number' && isSection(v.chord) && isSection(v.web);
}

/** A planar polygon's area (Newell's normal, half its length). */
function polygonArea(pts: readonly V3[]): number {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(n[0], n[1], n[2]) / 2;
}

const planArea = (pts: readonly V3[]) => polygonArea(pts.map(([x, y]) => [x, y, 0] as const));

/** A closed triangle mesh's volume (divergence theorem). */
function meshVolume(points: readonly V3[], triangles: readonly (readonly number[])[]): number {
  let v = 0;
  for (const [i, j, k] of triangles) {
    const [a, b, c] = [points[i], points[j], points[k]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(v);
}

/** The area of the strip between two polylines walked side by side. */
function stripArea(left: readonly V3[], right: readonly V3[]): number {
  let a = 0;
  for (let i = 1; i < Math.min(left.length, right.length); i++) {
    a += polygonArea([left[i - 1], right[i - 1], right[i]]) + polygonArea([left[i - 1], right[i], left[i]]);
  }
  return a;
}

const isCorridorSpec = (v: Record<string, unknown>): v is Record<string, unknown> & CorridorSpec =>
  !!v.alignment && typeof v.alignment === 'object' && !!v.profile && typeof v.profile === 'object'
  && !!v.assembly && typeof v.assembly === 'object' && positive(v.interval) !== null;

function corridorQuantities(e: NativeSystem, ctx: SystemQuantityContext): { set: string; quantities: Quantity[] } | null {
  if (!isCorridorSpec(e.spec)) return null;
  const terrainId = typeof e.spec.terrainGlobalId === 'string' ? e.spec.terrainGlobalId : null;
  const tin = terrainId && ctx.terrain ? ctx.terrain(terrainId, e.storeyId) : null;
  let model: ReturnType<typeof buildCorridor>;
  try {
    model = buildCorridor(e.spec, tin ? new Terrain(tin) : null);
  } catch {
    return null;
  }
  const courses = model.solids.filter((s) => s.kind === 'course' && s.closed);
  return { set: 'Lapin_CorridorQuantities', quantities: [
    length('Length', model.alignment.length),
    area('PavementArea', stripArea(model.edges.left, model.edges.right)),
    volume('PavementVolume', courses.reduce((sum, s) => sum + meshVolume(s.points, s.triangles), 0)),
    ...(tin ? [volume('CutVolume', model.volumes.cut), volume('FillVolume', model.volumes.fill)] : []),
  ] };
}

/** `e`'s base quantity set, or null when its family gives none (or its spec cannot be read). */
export function systemQuantities(e: NativeSystem, ctx: SystemQuantityContext = {}): { set: string; quantities: Quantity[] } | null {
  const spec = e.spec;
  if (e.family === 'railing') {
    const path = points(spec.Path, 3);
    if (!path || path.length < 2) return null;
    const len = path.slice(1).reduce((sum, b, i) => sum + Math.hypot(b[0] - path[i][0], b[1] - path[i][1], b[2] - path[i][2]), 0);
    return { set: 'Qto_RailingBaseQuantities', quantities: [length('Length', len)] };
  }
  if (e.family === 'roof') {
    const outline = points(spec.outline, 2);
    if (!outline || !Array.isArray(spec.rules)) return null;
    try {
      const planes = roofGeometry(outline as [number, number][], spec.rules as RoofEdgeRule[]).planes.map((p) => p.pts as V3[]);
      return { set: 'Qto_RoofBaseQuantities', quantities: [
        area('GrossArea', planes.reduce((sum, p) => sum + polygonArea(p), 0)),
        area('ProjectedArea', planes.reduce((sum, p) => sum + planArea(p), 0)),
      ] };
    } catch {
      return null;
    }
  }
  if (e.family === 'curtainWall') {
    const [start, end, height] = [spec.start, spec.end, positive(spec.height)];
    if (!isPoint(start, 3) || !isPoint(end, 3) || height === null) return null;
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    return { set: 'Qto_CurtainWallQuantities', quantities: [length('Length', len), length('Height', height), area('GrossSideArea', len * height)] };
  }
  if (e.family === 'stair') {
    const [risers, riser, tread, width] = [positive(spec.NumberOfRisers), positive(spec.RiserHeight), positive(spec.TreadLength), positive(spec.Width)];
    if (risers === null || riser === null || tread === null || width === null) return null;
    const waist = positive(spec.WaistThickness) ?? undefined;
    const outline = stairFlightOutline(risers, riser, tread, waist);
    const profile = Math.abs(outline.reduce((a, p, i) => { const q = outline[(i + 1) % outline.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    return { set: 'Qto_StairBaseQuantities', quantities: [length('Length', risers * tread), volume('GrossVolume', profile * width), volume('NetVolume', profile * width)] };
  }
  if (e.family === 'corridor') return corridorQuantities(e, ctx);
  if (e.family === 'padFooting') {
    if (!Array.isArray(spec.steps) || padFootingProblems({ steps: spec.steps as PadStep[], bottom: Number(spec.bottom) }).length) return null;
    const q = padFootingQuantities({ steps: spec.steps as PadStep[] });
    return { set: 'Qto_FootingBaseQuantities', quantities: [
      length('Length', q.length), length('Width', q.width), length('Height', q.height),
      area('CrossSectionArea', q.footprint), area('OuterSurfaceArea', q.outerSurface), volume('GrossVolume', q.volume), volume('NetVolume', q.volume),
    ] };
  }
  if (e.family === 'stripFoundation') {
    const s = spec as unknown as StripFoundationSpec;
    if (!isPoint(spec.start, 3) || !isPoint(spec.end, 3) || !Array.isArray(spec.layers) || stripFoundationProblems(s).length) return null;
    const q = stripFoundationQuantities(s);
    return { set: 'Lapin_StripFoundationQuantities', quantities: [
      length('Length', q.length), length('FootingWidth', s.footingWidth), length('FootingHeight', s.footingHeight), length('StemHeight', s.stemHeight),
      area('FootingArea', q.footingArea), area('StemSideArea', q.stemSideArea),
      volume('FootingVolume', q.footingVolume), volume('StemVolume', q.stemVolume), volume('CoreVolume', q.coreVolume), volume('ConcreteVolume', q.footingVolume + q.coreVolume),
    ] };
  }
  if (e.family === 'truss') {
    if (!isTrussSpec(spec) || trussProblem(spec)) return null;
    const bars = trussBars(spec);
    const lengths = bars.map((b) => Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]));
    const timber = bars.reduce((sum, b, i) => sum + lengths[i] * b.section.width * b.section.depth, 0);
    const span = positive(spec.span), rise = positive(spec.rise);
    return { set: 'Lapin_TrussQuantities', quantities: [
      ...(span === null ? [] : [length('Span', span)]), ...(rise === null ? [] : [length('Rise', rise)]),
      count('Members', bars.length), length('TimberLength', lengths.reduce((a, l) => a + l, 0)), volume('TimberVolume', timber),
    ] };
  }
  return null;
}
