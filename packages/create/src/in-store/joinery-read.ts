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
