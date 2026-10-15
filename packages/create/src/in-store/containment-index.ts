/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The spatial structure an element is contained in, without reading every
 * IfcRelContainedInSpatialStructure of the model: every element carries its
 * own, so the scan an opening cut or a placed door made cost the size of the
 * model, and authoring went quadratic (N8).
 *
 *  - Relations the session created: indexed per view as they are created
 *    (the overlay's append-only creation log), each read once.
 *  - Relations in the file: the store's relationship graph, indexed at parse.
 *  - Relations the session edited: read from the overlay.
 *
 * Every candidate is checked against the relation as it reads now (deleted,
 * edited), so an index entry that went stale is passed over; a miss is
 * confirmed by the whole scan, as is every lookup in a store without a
 * relationship graph.
 */

import { RelationshipType } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { AnchorEntityReader } from './resolve-anchor.js';
import { refId } from './host-geometry-frame.js';

const REL = 'IFCRELCONTAINEDINSPATIALSTRUCTURE';

interface CreatedIndex {
  /** The creation log read, and how far. */
  log: readonly number[];
  read: number;
  /** Element -> the created relations that listed it when read. */
  byElement: Map<number, number[]>;
}

const created = new WeakMap<MutablePropertyView, CreatedIndex>();

function named(record: { names: string[]; attributes: unknown[] }, name: string, fallback: number): unknown {
  const index = record.names.indexOf(name);
  return record.attributes[index >= 0 ? index : fallback];
}

/** `relId`'s relating structure when it is live and lists `elementId`. */
function check(reader: AnchorEntityReader, relId: number, elementId: number): number | null {
  const rel = reader.entity(relId);
  const related = rel ? named(rel, 'RelatedElements', 4) : null;
  if (!rel || rel.type.toUpperCase() !== REL || !Array.isArray(related) || !related.some((v) => refId(v) === elementId)) return null;
  return refId(named(rel, 'RelatingStructure', 5));
}

function createdIndex(view: MutablePropertyView, reader: AnchorEntityReader): CreatedIndex {
  const log = view.getNewEntityIdsAddedOfType(REL);
  let index = created.get(view);
  if (!index || index.log !== log) created.set(view, index = { log, read: 0, byElement: new Map() });
  for (; index.read < log.length; index.read++) {
    const rel = reader.entity(log[index.read]);
    const related = rel ? named(rel, 'RelatedElements', 4) : null;
    if (!Array.isArray(related)) continue;
    for (const value of related) {
      const id = refId(value);
      if (id !== null) index.byElement.set(id, [...(index.byElement.get(id) ?? []), log[index.read]]);
    }
  }
  return index;
}

const sourceType = (store: IfcDataStore, view: MutablePropertyView, id: number) =>
  (view.getEntityTypeMutation(id)?.newType ?? view.getNewEntity(id)?.type ?? store.entityIndex.byId.get(id)?.type)?.toUpperCase();

/** The structure (storey, building, ...) `elementId` is contained in, or null. */
export function containingStructure(
  store: IfcDataStore,
  view: MutablePropertyView | null | undefined,
  reader: AnchorEntityReader,
  elementId: number,
): number | null {
  const scan = () => {
    for (const relId of reader.ids(REL)) {
      const hit = check(reader, relId, elementId);
      if (hit !== null) return hit;
    }
    return null;
  };
  const graph = store.relationships;
  if (!graph) return scan();
  const candidates: number[] = [];
  if (view) {
    candidates.push(...(createdIndex(view, reader).byElement.get(elementId) ?? []));
    // A source relation edited this session (an element moved onto it) has no graph edge to it.
    candidates.push(...view.getAttributeOverrideEntityIds().filter((id) => sourceType(store, view, id) === REL));
  }
  for (const edge of graph.inverse.getEdges(elementId, RelationshipType.ContainsElements)) {
    candidates.push(edge.relationshipId, ...(edge.shadowedRelationshipIds ?? []));
  }
  for (const relId of candidates) {
    const hit = check(reader, relId, elementId);
    if (hit !== null) return hit;
  }
  // Not found where it would be (a relation re-written in place, say): the whole scan before a miss is believed.
  return scan();
}
