/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What an IFC export adds for the elements a native model describes (N6):
 *  - the standard base quantity set of each (`Qto_WallBaseQuantities`, ...,
 *    `ifc-mapping.ts`), computed from its parameters: lengths, gross and net
 *    areas and volumes, the net ones less its openings;
 *  - `Pset_LapinNative`, its class, schema version and parameters as JSON, so
 *    a Lapin IFC read back (N7) becomes the same native element again.
 *
 * Written onto an overlay (the export's own copy, never the session's). An
 * element exported by Lapin before (it carries `Pset_LapinNative`) has both
 * sets replaced, so they follow its parameters; one that carries a quantity
 * set of its own (an imported model's) keeps that.
 */

import { QuantityType, PropertyValueType } from '@ifc-lite/data';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { ProfileSection } from '../in-store/profile.js';
import { NATIVE_IFC, NATIVE_PSET } from './ifc-mapping.js';
import { solidMeasures } from './solid.js';
import type { NativeElement, NativeId, NativeModel, PlanPoint } from './schema.js';
import { NATIVE_SCHEMA_VERSION } from './schema.js';
import { nativeIndex, nativeSection, resolveNativeParam, ringArea2, type NativeIndex } from './validate.js';

interface Quantity { name: string; value: number; quantityType: QuantityType }

const length = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Length });
const area = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Area });
const volume = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Volume });
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A section's area (m²), for the sections whose area has a closed form; fillets left out. */
export function sectionArea(s: ProfileSection): number | undefined {
  switch (s.Type) {
    case 'Rectangle': return s.XDim * s.YDim;
    case 'Circle': return Math.PI * s.Radius ** 2;
    case 'CircleHollow': return Math.PI * (s.Radius ** 2 - (s.Radius - s.WallThickness) ** 2);
    case 'RectangleHollow': return s.XDim * s.YDim - (s.XDim - 2 * s.WallThickness) * (s.YDim - 2 * s.WallThickness);
    case 'I': return 2 * s.OverallWidth * s.FlangeThickness + (s.OverallDepth - 2 * s.FlangeThickness) * s.WebThickness;
    case 'L': return s.Thickness * (s.Depth + s.Width - s.Thickness);
    case 'T': return s.FlangeWidth * s.FlangeThickness + (s.Depth - s.FlangeThickness) * s.WebThickness;
    case 'U': return 2 * s.FlangeWidth * s.FlangeThickness + (s.Depth - 2 * s.FlangeThickness) * s.WebThickness;
    default: return undefined;
  }
}

function perimeter(ring: readonly PlanPoint[]): number {
  let p = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

/** The face area an opening or a door / window takes out of its host wall (width x height), m². */
function cutFace(e: NativeElement, index: NativeIndex): number {
  if (e.kind === 'opening' && e.host === 'wall') return e.width * e.height;
  if (e.kind === 'door' || e.kind === 'window') {
    const type = e.typeId ? index.type(e.typeId) : undefined;
    return type && 'spec' in type ? type.spec.width * type.spec.height : 0;
  }
  return 0;
}

/** The base quantities of `e` (its class's set), or null when it has none to give. */
export function nativeQuantities(e: NativeElement, index: NativeIndex, hosted: readonly NativeElement[]): { set: string; quantities: Quantity[] } | null {
  const all = parametricQuantities(e, index, hosted);
  // A body combined in Studio is more than its parameters: its lengths hold, its areas and volumes would not.
  return all && e.combined ? { set: all.set, quantities: all.quantities.filter((q) => q.quantityType === QuantityType.Length) } : all;
}

function parametricQuantities(e: NativeElement, index: NativeIndex, hosted: readonly NativeElement[]): { set: string; quantities: Quantity[] } | null {
  const set = NATIVE_IFC[e.kind].quantitySet;
  if (!set) return null;
  if (e.kind === 'wall') {
    const [h, t] = [num(resolveNativeParam(e, 'height', index)), num(resolveNativeParam(e, 'thickness', index))];
    if (h === undefined || t === undefined) return null;
    const len = Math.hypot(e.end[0] - e.start[0], e.end[1] - e.start[1]);
    const cut = hosted.reduce((sum, o) => sum + cutFace(o, index), 0);
    return { set, quantities: [
      length('Length', len), length('Width', t), length('Height', h),
      area('GrossFootprintArea', len * t), area('GrossSideArea', len * h), area('NetSideArea', Math.max(0, len * h - cut)),
      volume('GrossVolume', len * t * h), volume('NetVolume', Math.max(0, (len * h - cut) * t)),
    ] };
  }
  if (e.kind === 'slab') {
    const t = num(resolveNativeParam(e, 'thickness', index));
    if (t === undefined) return null;
    const gross = Math.abs(ringArea2(e.outline)) / 2;
    const holes = (e.holes ?? []).reduce((sum, h) => sum + Math.abs(ringArea2(h)) / 2, 0);
    const cut = hosted.reduce((sum, o) => sum + (o.kind === 'opening' && o.host === 'slab' ? o.width * o.depth : 0), 0);
    const net = Math.max(0, gross - holes - cut);
    return { set, quantities: [
      length('Depth', t), length('Perimeter', perimeter(e.outline)),
      area('GrossArea', gross), area('NetArea', net), volume('GrossVolume', gross * t), volume('NetVolume', net * t),
    ] };
  }
  if (e.kind === 'beam' || e.kind === 'column') {
    const len = e.kind === 'beam'
      ? Math.hypot(e.end[0] - e.start[0], e.end[1] - e.start[1], e.end[2] - e.start[2])
      : num(resolveNativeParam(e, 'height', index));
    const section = nativeSection(e, index);
    if (len === undefined) return null;
    const a = section ? sectionArea(section) : undefined;
    return { set, quantities: [length('Length', len), ...(a === undefined ? [] : [area('CrossSectionArea', a), volume('GrossVolume', a * len)])] };
  }
  if (e.kind === 'solid') {
    // The proxy's standard set; a solid written as another class (a Studio wall) has its Qto from the Studio builder.
    if (e.ifcClass.toUpperCase() !== 'IFCBUILDINGELEMENTPROXY') return null;
    const m = solidMeasures(e.shape);
    return { set, quantities: [area('NetSurfaceArea', m.surface), volume('NetVolume', m.volume)] };
  }
  if (e.kind === 'opening') {
    return e.host === 'wall'
      ? { set, quantities: [length('Width', e.width), length('Height', e.height)] }
      : { set, quantities: [length('Width', e.width), length('Depth', e.depth)] };
  }
  const type = e.typeId ? index.type(e.typeId) : undefined;
  if (!type || !('spec' in type)) return null;
  const { width, height } = type.spec;
  return { set, quantities: [length('Width', width), length('Height', height), area('Area', width * height)] };
}

/** `Pset_LapinNative` of `e`: what N7 reads back. */
export function nativePset(e: NativeElement): Array<{ name: string; value: string | number; type: PropertyValueType }> {
  const { id: _id, kind, storeyId: _storey, ...parameters } = e;
  return [
    { name: 'Class', value: kind, type: PropertyValueType.Label },
    { name: 'SchemaVersion', value: NATIVE_SCHEMA_VERSION, type: PropertyValueType.Integer },
    { name: 'Parameters', value: JSON.stringify(parameters), type: PropertyValueType.Text },
  ];
}

export interface NativeExportSets { quantitySets: number; propertySets: number }

/**
 * Write the base quantities and `Pset_LapinNative` of every element of
 * `model` onto `view` (`expressIds`: native id → express id, from the lift).
 */
export function writeNativeExportSets(view: MutablePropertyView, model: NativeModel, expressIds: ReadonlyMap<NativeId, number>): NativeExportSets {
  const index = nativeIndex(model);
  const hostedBy = new Map<NativeId, NativeElement[]>();
  for (const e of model.elements) {
    if (e.kind === 'opening' || e.kind === 'door' || e.kind === 'window') hostedBy.set(e.hostId, [...(hostedBy.get(e.hostId) ?? []), e]);
  }
  const out: NativeExportSets = { quantitySets: 0, propertySets: 0 };
  for (const e of model.elements) {
    const id = expressIds.get(e.id);
    if (id === undefined) continue;
    const quantities = nativeQuantities(e, index, hostedBy.get(e.id) ?? []);
    const ours = view.getForEntity(id).some((p) => p.name === NATIVE_PSET);
    const has = (name: string) => (view.getQuantitiesForEntity(id) ?? []).some((q) => q.name === name);
    if (quantities && (!has(quantities.set) || ours)) {
      if (has(quantities.set)) view.deleteQuantitySet(id, quantities.set);
      view.createQuantitySet(id, quantities.set, quantities.quantities);
      out.quantitySets++;
    }
    if (ours) view.deletePropertySet(id, NATIVE_PSET);
    view.createPropertySet(id, NATIVE_PSET, nativePset(e));
    out.propertySets++;
  }
  return out;
}
