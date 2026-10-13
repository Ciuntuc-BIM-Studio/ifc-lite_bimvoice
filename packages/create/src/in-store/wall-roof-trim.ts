/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A wall attached to a roof system (Revit's "Attach Top"): the wall rises to
 * the roof and only what is under the roof stays.
 *
 * The attachment is stored on the wall as Pset_IfcLiteRoofTrim (its Spec: the
 * roof's GlobalId, where the cut runs, and for a gable wall the roof edge it
 * closes). `syncWallRoofTrimInStore` rebuilds the trim from the roof as it is
 * now: every roof plane over the wall cuts it with an
 * IfcPolygonalBoundedHalfSpace bounded by that plane's outline, so the cut is
 * exact on any roof (hips, valleys, different pitches), and the extrusion is
 * set to reach the highest point of the roof over the wall. The wall's own
 * solid is kept inside the trim (`body-trim.ts`), so its axis, joins and flip
 * stay editable; the trim is rebuilt after any edit of the wall or the roof.
 *
 * The cut runs under the roof's covering (`covering`) or under its structure
 * too (`structure`: the rafters or the trusses' top chords).
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { isRoofTrim, untrimmedSolid } from './body-trim.js';
import { getModelLengthUnitScale } from './edit/length-unit-scale.js';
import { pruneOrphanOverlay } from './overlay-prune.js';
import { compose, invert, worldFrame, type Frame3D, type V3 } from './placement-3d.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { coveringThickness } from './roof-system-material.js';
import { readRoofSystem, type RoofSystemSpec } from './roof-system-store.js';
import { offsetEdges, roofGeometry } from './roof-system.js';
import { readWallMetres } from './wall-size-edit.js';

export const ROOF_TRIM_PSET = 'Pset_IfcLiteRoofTrim';

export type RoofTrimTop = 'covering' | 'structure';

export interface WallRoofTrim {
  /** GlobalId of the IfcRoof of the roof system. */
  roof: string;
  /** Under the covering only, or under the structure too. */
  top: RoofTrimTop;
  /** A gable wall made by the roof system: the outline edge it closes. */
  gable?: number;
}

type Anchor = Pick<SpatialAnchor, 'ownerHistoryId' | 'guidRandom'>;
type Attr = Parameters<StoreEditor['addEntity']>[1];

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

const textOf = (v: unknown): string | null => {
  const raw = Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
  return typeof raw === 'string' ? raw : null;
};

interface TrimRead { trim: WallRoofTrim; psetId: number; relId: number }

function readTrimRecord(reader: AnchorEntityReader, wallId: number): TrimRead | null {
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    if (!rel || !Array.isArray(rel.attributes[4]) || !rel.attributes[4].some((r) => refId(r) === wallId)) continue;
    const psetId = refId(rel.attributes[5]);
    const set = psetId === null ? null : reader.entity(psetId);
    if (!set || set.attributes[2] !== ROOF_TRIM_PSET) continue;
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const prop = reader.entity(refId(p) ?? -1);
      if (prop?.attributes[0] !== 'Spec') continue;
      try {
        const raw = JSON.parse(textOf(prop.attributes[2]) ?? '') as Partial<WallRoofTrim>;
        if (typeof raw.roof !== 'string') continue;
        const trim: WallRoofTrim = { roof: raw.roof, top: raw.top === 'covering' ? 'covering' : 'structure', ...(typeof raw.gable === 'number' ? { gable: raw.gable } : {}) };
        return { trim, psetId: psetId!, relId };
      } catch (err) {
        console.warn(`[wall-roof-trim] wall #${wallId}: unreadable ${ROOF_TRIM_PSET}`, err);
      }
    }
  }
  return null;
}

/** The roof a wall is attached to, or null. */
export function readWallRoofTrim(store: IfcDataStore, wallId: number, view?: MutablePropertyView | null): WallRoofTrim | null {
  return readTrimRecord(new AnchorEntityReader(store, view), wallId)?.trim ?? null;
}

/** Every wall attached to a roof (to the roof `roofGlobalId` only, when given). */
export function roofTrimmedWalls(store: IfcDataStore, view?: MutablePropertyView | null, roofGlobalId?: string): { wallId: number; trim: WallRoofTrim }[] {
  const reader = new AnchorEntityReader(store, view);
  const out: { wallId: number; trim: WallRoofTrim }[] = [];
  const seen = new Set<number>();
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    const set = rel ? reader.entity(refId(rel.attributes[5]) ?? -1) : null;
    if (!rel || set?.attributes[2] !== ROOF_TRIM_PSET || !Array.isArray(rel.attributes[4])) continue;
    for (const r of rel.attributes[4]) {
      const wallId = refId(r);
      if (wallId === null || seen.has(wallId) || !reader.entity(wallId)) continue;
      const trim = readTrimRecord(reader, wallId)?.trim;
      if (trim && (roofGlobalId === undefined || trim.roof === roofGlobalId)) {
        seen.add(wallId);
        out.push({ wallId, trim });
      }
    }
  }
  return out;
}

/** Attach a wall to a roof (`trim`), or detach it (null): the record, then the trim rebuilt. */
export function setWallRoofTrimInStore(store: IfcDataStore, editor: StoreEditor, anchor: Anchor, wallId: number, trim: WallRoofTrim | null): void {
  const reader = new AnchorEntityReader(store, editor.getMutationView());
  const old = readTrimRecord(reader, wallId);
  if (old) {
    const props = reader.entity(old.psetId)?.attributes[4];
    editor.removeEntity(old.relId);
    editor.removeEntity(old.psetId);
    for (const p of Array.isArray(props) ? props : []) { const id = refId(p); if (id !== null) editor.removeEntity(id); }
  }
  if (trim) {
    const spec = editor.addEntity('IfcPropertySingleValue', ['Spec', null, { typed: { type: 'IfcText', value: JSON.stringify(trim) } }, null] as Attr).expressId;
    const pset = editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), ROOF_TRIM_PSET, null, [`#${spec}`]] as Attr).expressId;
    editor.addEntity('IfcRelDefinesByProperties', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, [`#${wallId}`], `#${pset}`] as Attr);
  }
  syncWallRoofTrimInStore(store, editor, wallId);
}

/** The roof (IfcRoof id and its system spec) with `globalId`. */
function roofByGlobalId(store: IfcDataStore, view: MutablePropertyView, reader: AnchorEntityReader, globalId: string): { roofId: number; spec: RoofSystemSpec } | null {
  for (const id of reader.ids('IFCROOF')) {
    const fresh = view.getNewEntity(id)?.attributes[0];
    const gid = typeof fresh === 'string' ? fresh : reader.entity(id)?.attributes[0];
    if (gid !== globalId) continue;
    const spec = readRoofSystem(store, id, view);
    return spec ? { roofId: id, spec } : null;
  }
  return null;
}

/** How far under the roof surface the cut runs, measured across the slope (metres). */
export function roofTrimDepth(spec: Pick<RoofSystemSpec, 'covering' | 'structure'>, top: RoofTrimTop): number {
  const covering = coveringThickness(spec.covering);
  if (top === 'covering') return covering;
  const s = spec.structure;
  if (s.system === 'rafters') return Math.max(covering, s.coverDepth + s.rafter.depth);
  if (s.system === 'trusses' && s.truss) return Math.max(covering, s.coverDepth + s.truss.chord.depth);
  return covering;
}

const apply = (f: Frame3D, p: readonly number[]): V3 => [
  f.r[0][0] * p[0] + f.r[0][1] * p[1] + f.r[0][2] * p[2] + f.t[0],
  f.r[1][0] * p[0] + f.r[1][1] * p[1] + f.r[1][2] * p[2] + f.t[1],
  f.r[2][0] * p[0] + f.r[2][1] * p[1] + f.r[2][2] * p[2] + f.t[2],
];

/** Keep the part of a planar loop with `side(p) ≥ 0` (one vertical half-plane). */
function clip(loop: readonly V3[], side: (p: V3) => number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    const dp = side(p), dq = side(q);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  return out;
}

/** Newell's normal of a planar loop, unit, pointing up. */
function upNormal(loop: readonly V3[]): V3 | null {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12 || Math.abs(nz) < 1e-9) return null;
  const s = nz < 0 ? -1 / l : 1 / l;
  return [nx * s, ny * s, nz * s];
}

export interface RoofTrimCut {
  /** The cut's outline in the wall's frame (counter-clockwise from above), metres, on the cutting plane. */
  loop: V3[];
  normal: V3;
}

/**
 * The cuts of a roof over a wall, in the wall's frame: each roof plane
 * lowered by `depth` across its slope, kept over the wall's footprint
 * (`box`: x and y ranges in the wall's frame) and over nothing else.
 */
export function roofTrimCuts(spec: RoofSystemSpec, roofToWall: Frame3D, box: { x: [number, number]; y: [number, number] }, depth: number): RoofTrimCut[] {
  const g = roofGeometry(spec.outline, spec.rules);
  const cuts: RoofTrimCut[] = [];
  for (const plane of g.planes) {
    const drop = depth / Math.cos((plane.pitch * Math.PI) / 180);
    let loop = plane.pts.map((p) => apply(roofToWall, [p[0], p[1], p[2] + spec.eaveHeight - drop]));
    loop = clip(loop, (p) => p[0] - box.x[0]);
    loop = clip(loop, (p) => box.x[1] - p[0]);
    loop = clip(loop, (p) => p[1] - box.y[0]);
    loop = clip(loop, (p) => box.y[1] - p[1]);
    loop = loop.filter((p, i) => Math.hypot(p[0] - loop[(i + loop.length - 1) % loop.length][0], p[1] - loop[(i + loop.length - 1) % loop.length][1]) > 1e-6);
    if (loop.length < 3) continue;
    const normal = upNormal(loop);
    if (!normal) continue;
    // Counter-clockwise seen from above.
    const area = loop.reduce((s, p, i) => s + p[0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * p[1], 0);
    cuts.push({ loop: area < 0 ? [...loop].reverse() : loop, normal });
  }
  return cuts;
}

interface WallBody { repId: number; items: unknown[]; itemId: number; solidId: number }

function wallBody(reader: AnchorEntityReader, wallId: number): WallBody | null {
  const shape = reader.entity(refId(reader.entity(wallId)?.attributes[6]) ?? -1);
  if (shape?.type.toUpperCase() !== 'IFCPRODUCTDEFINITIONSHAPE' || !Array.isArray(shape.attributes[2])) return null;
  const reps = (shape.attributes[2] as unknown[]).map(refId).filter((id): id is number => id !== null);
  const repId = reps.find((id) => reader.entity(id)?.attributes[1] === 'Body') ?? reps[0];
  const rep = repId === undefined ? null : reader.entity(repId);
  const items = Array.isArray(rep?.attributes[3]) ? [...(rep!.attributes[3] as unknown[])] : [];
  const itemId = refId(items[0]);
  if (repId === undefined || itemId === null) return null;
  const solidId = untrimmedSolid((id) => reader.entity(id), itemId);
  return reader.entity(solidId)?.type.toUpperCase() === 'IFCEXTRUDEDAREASOLID' ? { repId, items, itemId, solidId } : null;
}

/**
 * Rebuild a wall's roof trim from its record and the roof as it is now (or
 * take it off when the wall is attached to nothing, or the roof is gone).
 * True when the body changed (re-mesh the wall).
 */
export function syncWallRoofTrimInStore(store: IfcDataStore, editor: StoreEditor, wallId: number): boolean {
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const body = wallBody(reader, wallId);
  if (!body) return false;
  const record = readTrimRecord(reader, wallId)?.trim ?? null;
  const roof = record ? roofByGlobalId(store, view, reader, record.roof) : null;
  const scale = getModelLengthUnitScale(store);
  const native = (m: number) => m / scale;
  const wasTrimmed = isRoofTrim((id) => reader.entity(id), body.itemId);

  let cuts: RoofTrimCut[] = [];
  let solidBase = 0;
  if (record && roof) {
    const wallPlacement = refId(reader.entity(wallId)?.attributes[5]);
    const roofPlacement = refId(reader.entity(roof.roofId)?.attributes[5]);
    const wallFrame = wallPlacement === null ? null : worldFrame({ dataStore: store, view }, wallPlacement);
    const roofFrame = roofPlacement === null ? null : worldFrame({ dataStore: store, view }, roofPlacement);
    const metres = readWallMetres({ dataStore: store, view, editor }, wallId);
    if (wallFrame && roofFrame && metres) {
      const length = Math.hypot(metres.end[0] - metres.start[0], metres.end[1] - metres.start[1]);
      const margin = Math.max(0.5, metres.thickness);
      const box = { x: [-margin, length + margin] as [number, number], y: [-(metres.thickness / 2 + margin), metres.thickness / 2 + margin] as [number, number] };
      cuts = roofTrimCuts(roof.spec, compose(invert(wallFrame), roofFrame), box, roofTrimDepth(roof.spec, record.top));
      const position = reader.entity(refId(reader.entity(body.solidId)?.attributes[1]) ?? -1);
      const location = reader.entity(refId(position?.attributes[0]) ?? -1)?.attributes[0];
      solidBase = Array.isArray(location) && typeof location[2] === 'number' ? location[2] * scale : 0;
    }
  }

  const point = (p: readonly number[]) => `#${editor.addEntity('IfcCartesianPoint', [p.map((v) => native(v))] as Attr).expressId}`;
  const direction = (d: readonly number[]) => `#${editor.addEntity('IfcDirection', [[...d]] as Attr).expressId}`;
  let item = body.solidId;
  if (cuts.length) {
    // The extrusion reaches the roof's highest point over the wall; the cuts take off the rest.
    const top = Math.max(...cuts.flatMap((c) => c.loop.map((p) => p[2])));
    if (top - solidBase > 0.01) editor.setPositionalAttribute(body.solidId, 3, native(top - solidBase));
    for (const cut of cuts) {
      const n = cut.normal;
      // Any direction square to the normal for the plane's X.
      const x = Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [-n[2], 0, n[0]];
      const xl = Math.hypot(...x);
      const planePos = editor.addEntity('IfcAxis2Placement3D', [point(cut.loop[0]), direction(n), direction(x.map((v) => v / xl))] as Attr).expressId;
      const plane = editor.addEntity('IfcPlane', [`#${planePos}`] as Attr).expressId;
      const boundaryPos = editor.addEntity('IfcAxis2Placement3D', [point([0, 0, 0]), null, null] as Attr).expressId;
      const ring = [...cut.loop, cut.loop[0]].map((p) => `#${editor.addEntity('IfcCartesianPoint', [[native(p[0]), native(p[1])]] as Attr).expressId}`);
      const boundary = editor.addEntity('IfcPolyline', [ring] as Attr).expressId;
      // AgreementFlag FALSE: the half space's material lies on the side the plane's normal (up) points to.
      const half = editor.addEntity('IfcPolygonalBoundedHalfSpace', [`#${plane}`, '.F.', `#${boundaryPos}`, `#${boundary}`] as Attr).expressId;
      item = editor.addEntity('IfcBooleanClippingResult', ['.DIFFERENCE.', `#${item}`, `#${half}`] as Attr).expressId;
    }
  } else if (!wasTrimmed) {
    return false;
  }
  editor.setPositionalAttribute(body.repId, 2, cuts.length ? 'Clipping' : 'SweptSolid');
  editor.setPositionalAttribute(body.repId, 3, [`#${item}`, ...body.items.slice(1)] as Attr[number]);
  if (wasTrimmed) pruneOrphanOverlay(editor, [body.itemId]);
  return true;
}

/** A gable wall's axis (storey-local metres, on the wall plate) and the height it starts at before the roof cuts it. */
export interface GableWallLine {
  edge: number;
  start: V3;
  end: V3;
  height: number;
}

/** Where a roof system's gable walls go: one per gable edge, outer face `offset` inside the outline. */
export function gableWallLines(spec: Pick<RoofSystemSpec, 'outline' | 'rules' | 'eaveHeight'>, thickness: number, offset: number, flip: boolean): GableWallLine[] {
  const g = roofGeometry(spec.outline, spec.rules);
  const n = g.outline.length;
  return g.gables.map(({ edge, pts }) => {
    const a = g.outline[edge], b = g.outline[(edge + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Inside a counter-clockwise outline is left of its edges.
    const k = offset + thickness / 2;
    const nx = -(b[1] - a[1]) / l * k, ny = (b[0] - a[0]) / l * k;
    const s: V3 = [a[0] + nx, a[1] + ny, spec.eaveHeight], e: V3 = [b[0] + nx, b[1] + ny, spec.eaveHeight];
    const apex = Math.max(...pts.map((p) => p[2]));
    return { edge, start: flip ? e : s, end: flip ? s : e, height: Math.max(apex, 0.1) + 0.1 };
  });
}

function inside(pts: readonly [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * The roof system over a wall: one whose footprint (the outline out to its
 * overhangs) holds the wall's middle and whose wall plate is above the
 * wall's foot; the lowest such roof. Its IfcRoof GlobalId, or null.
 */
export function roofOverWall(store: IfcDataStore, editor: StoreEditor, wallId: number): string | null {
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const metres = readWallMetres({ dataStore: store, view, editor }, wallId);
  const wallPlacement = refId(reader.entity(wallId)?.attributes[5]);
  const wallFrame = wallPlacement === null ? null : worldFrame({ dataStore: store, view }, wallPlacement);
  if (!metres || !wallFrame) return null;
  const length = Math.hypot(metres.end[0] - metres.start[0], metres.end[1] - metres.start[1]);
  const middle = apply(wallFrame, [length / 2, 0, 0]);
  let best: { globalId: string; eave: number } | null = null;
  for (const id of reader.ids('IFCROOF')) {
    const spec = readRoofSystem(store, id, view);
    const placement = refId(reader.entity(id)?.attributes[5]);
    const frame = placement === null ? null : worldFrame({ dataStore: store, view }, placement);
    if (!spec || !frame) continue;
    const local = apply(invert(frame), middle);
    const g = roofGeometry(spec.outline, spec.rules);
    const footprint = offsetEdges(g.outline, g.rules.map((r) => r.overhang));
    if (!inside(footprint, local[0], local[1]) || spec.eaveHeight < local[2] - 1e-6) continue;
    const fresh = view.getNewEntity(id)?.attributes[0];
    const globalId = typeof fresh === 'string' ? fresh : reader.entity(id)?.attributes[0];
    if (typeof globalId === 'string' && (!best || spec.eaveHeight < best.eave)) best = { globalId, eave: spec.eaveHeight };
  }
  return best?.globalId ?? null;
}
