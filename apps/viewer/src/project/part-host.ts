/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The host class of an IfcBuildingElementPart: models that split walls and
 * slabs into layer parts (IfcRelAggregates) draw the PARTS, so a view's
 * "Walls" graphics must reach the parts of walls too. Resolved through the
 * federation (renderer id → model + expressId), cached per model store.
 */

import { RelationshipType } from '@ifc-lite/data';
import { useViewerStore } from '@/store';

const PART = 'IFCBUILDINGELEMENTPART';
const cache = new WeakMap<object, Map<number, string | null>>();

/** The IFC class of the element a part belongs to, or null (not a part, or no host). */
export function partHostType(renderId: number, ifcType: string | undefined): string | null {
  if (!ifcType || ifcType.toUpperCase() !== PART) return null;
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const ds = ref ? s.models.get(ref.modelId)?.ifcDataStore : null;
  if (!ref || !ds) return null;
  let known = cache.get(ds);
  if (!known) cache.set(ds, (known = new Map()));
  if (known.has(ref.expressId)) return known.get(ref.expressId) ?? null;
  const parent = ds.relationships.getRelated(ref.expressId, RelationshipType.Aggregates, 'inverse')[0];
  const type = parent ? ds.entities.getTypeName(parent) || null : null;
  known.set(ref.expressId, type);
  return type;
}
