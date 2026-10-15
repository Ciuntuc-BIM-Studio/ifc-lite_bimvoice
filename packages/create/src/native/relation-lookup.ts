/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One relationship class of the live model, looked up per element (N8): an
 * edit's re-mesh reads the openings, cuts and layer usage of the elements it
 * re-meshes, not of the model, so it costs the edit and not the model's size.
 *
 *  - Relations in the file come from the store's relationship graph (indexed
 *    at parse), each read again through the overlay (a deleted one is gone, an
 *    edited one reads as edited).
 *  - Relations the session created or edited are read from the overlay, once
 *    per lookup.
 *
 * A store without a relationship graph is scanned whole, as before.
 */

import type { RelationshipType } from '@ifc-lite/data';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { EffectiveEntityRecord, IfcDataStore } from '@ifc-lite/parser';
import type { AnchorEntityReader } from '../in-store/resolve-anchor.js';

export interface RelationKind {
  /** The STEP class, uppercase. */
  type: string;
  /** The graph's edge for it, and the side the looked-up element is on (`forward`: the relating one). */
  edge: RelationshipType;
  direction: 'forward' | 'inverse';
  /** `[element, value]` pairs one relation gives (an empty list: it gives none). */
  pairs: (rel: EffectiveEntityRecord, reader: AnchorEntityReader) => Array<[number, number]>;
}

export class RelationLookup {
  private overlay: Map<number, number[]> | null = null;
  /** Relations read from the overlay (their graph edges are not read again). */
  private readonly touched = new Set<number>();

  constructor(
    private readonly store: IfcDataStore,
    private readonly view: MutablePropertyView,
    private readonly reader: AnchorEntityReader,
    private readonly kind: RelationKind,
  ) {}

  /** The values `id` has through this relation (openings, cutters, usage), in no particular order. */
  get(id: number): number[] | undefined {
    const overlay = this.overlayIndex();
    const graph = this.store.relationships;
    if (!graph) return overlay.get(id);
    const out = new Set(overlay.get(id) ?? []);
    for (const edge of graph[this.kind.direction].getEdges(id, this.kind.edge)) {
      for (const relId of [edge.relationshipId, ...(edge.shadowedRelationshipIds ?? [])]) {
        if (this.touched.has(relId)) continue;
        const rel = this.reader.entity(relId);
        if (rel?.type.toUpperCase() !== this.kind.type) continue;
        for (const [key, value] of this.kind.pairs(rel, this.reader)) if (key === id) out.add(value);
      }
    }
    return out.size ? [...out] : undefined;
  }

  private typeOf(id: number): string | undefined {
    return (this.view.getEntityTypeMutation(id)?.newType ?? this.view.getNewEntity(id)?.type ?? this.store.entityIndex.byId.get(id)?.type)?.toUpperCase();
  }

  /** Relations of this class the session created or edited, indexed (the whole class without a graph). */
  private overlayIndex(): Map<number, number[]> {
    if (this.overlay) return this.overlay;
    const index = new Map<number, number[]>();
    const ids = this.store.relationships
      ? [...[...this.view.getNewEntitiesOfType(this.kind.type)].map((e) => e.expressId), ...this.view.getAttributeOverrideEntityIds().filter((id) => this.typeOf(id) === this.kind.type)]
      : this.reader.ids(this.kind.type);
    for (const relId of ids) {
      if (this.touched.has(relId)) continue;
      this.touched.add(relId);
      const rel = this.reader.entity(relId);
      if (rel?.type.toUpperCase() !== this.kind.type) continue;
      for (const [key, value] of this.kind.pairs(rel, this.reader)) index.set(key, [...(index.get(key) ?? []), value]);
    }
    return (this.overlay = index);
  }
}
