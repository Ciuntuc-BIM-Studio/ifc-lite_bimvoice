/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Read a joinery spec back from a model: the `Spec` property of the type's
 * Pset_IfcLiteJoinery (`joinery-type.ts`), through the mutation overlay — a
 * type authored or rewritten this session and one parsed from a saved file
 * read alike. Also the type's representation map, which a new occurrence maps.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from './resolve-anchor.js';
import { JOINERY_PSET } from './joinery-type.js';
import type { JoinerySpec } from './joinery-spec.js';

function refId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return typeof value === 'string' && /^#[1-9][0-9]*$/.test(value) ? Number(value.slice(1)) : null;
}

/** A NominalValue as parsed (`[type, value]`), authored (`{ typed }`) or bare. */
function nominal(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 2 && typeof value[0] === 'string' ? value[1] : value[0];
  if (value && typeof value === 'object' && 'typed' in value) return (value as { typed: { value: unknown } }).typed.value;
  if (value && typeof value === 'object' && 'value' in value) return (value as { value: unknown }).value;
  return value;
}

export interface JoineryTypeRead {
  spec: JoinerySpec;
  /** The first IfcRepresentationMap, or null. */
  mapId: number | null;
  globalId: string;
}

/** The joinery spec stored on type `typeId`, or null when it is not a configured joinery type. */
export function readJoineryType(store: IfcDataStore, typeId: number, view?: MutablePropertyView | null): JoineryTypeRead | null {
  const reader = new AnchorEntityReader(store, view);
  const type = reader.entity(typeId);
  if (!type || !/^IFC(DOOR|WINDOW)TYPE$/i.test(type.type)) return null;
  const at = (name: string, fallback: number) => {
    const i = type.names.indexOf(name);
    return type.attributes[i >= 0 ? i : fallback];
  };
  const sets = at('HasPropertySets', 5);
  const maps = at('RepresentationMaps', 6);
  for (const ref of Array.isArray(sets) ? sets : []) {
    const id = refId(ref);
    const set = id === null ? null : reader.entity(id);
    if (!set || set.type.toUpperCase() !== 'IFCPROPERTYSET' || set.attributes[2] !== JOINERY_PSET) continue;
    const props = set.attributes[4];
    for (const p of Array.isArray(props) ? props : []) {
      const pid = refId(p);
      const prop = pid === null ? null : reader.entity(pid);
      if (!prop || prop.attributes[0] !== 'Spec') continue;
      const raw = nominal(prop.attributes[2]);
      if (typeof raw !== 'string') return null;
      try {
        const spec = JSON.parse(raw) as JoinerySpec;
        const mapId = Array.isArray(maps) ? refId(maps[0]) : null;
        const globalId = at('GlobalId', 0);
        return { spec, mapId, globalId: typeof globalId === 'string' ? globalId : '' };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function direction(reader: AnchorEntityReader, value: unknown): number[] | null {
  const id = refId(value);
  const ratios = id === null ? null : reader.entity(id)?.attributes[0];
  return Array.isArray(ratios) ? ratios.map((v) => (v && typeof v === 'object' && 'real' in v ? Number((v as { real: number }).real) : Number(v))) : null;
}

/**
 * How an occurrence's mapped body is turned (`emitMappedBody`'s `flips`):
 * read from its IfcMappedItem's operator axes; 0 for anything else.
 */
export function readJoineryFlips(store: IfcDataStore, productId: number, view?: MutablePropertyView | null): number {
  const reader = new AnchorEntityReader(store, view);
  const product = reader.entity(productId);
  const shape = product ? reader.entity(refId(product.attributes[6]) ?? -1) : null;
  const reps = shape?.attributes[2];
  for (const repRef of Array.isArray(reps) ? reps : []) {
    const rep = reader.entity(refId(repRef) ?? -1);
    const items = rep?.attributes[3];
    for (const itemRef of Array.isArray(items) ? items : []) {
      const item = reader.entity(refId(itemRef) ?? -1);
      if (item?.type.toUpperCase() !== 'IFCMAPPEDITEM') continue;
      const operator = reader.entity(refId(item.attributes[1]) ?? -1);
      if (!operator) return 0;
      const a1 = direction(reader, operator.attributes[0]), a2 = direction(reader, operator.attributes[1]);
      const turned = !!a2 && a2[1] < 0;
      const mirroredX = !!a1 && a1[0] < 0;
      return (mirroredX !== turned ? 1 : 0) | (turned ? 2 : 0);
    }
  }
  return 0;
}
