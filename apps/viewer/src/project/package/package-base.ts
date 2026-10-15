/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Saving a model as the IFC it was loaded from plus its edits (N4b): the
 * IFC's bytes, identity, first save time and geometry are taken once per
 * loaded model and reused by every later save, which then writes only the
 * edits (`model-delta.ts`). A model is compacted instead — written as one
 * IFC with all its edits, as before — when its edits cannot travel as an
 * overlay (georeferencing edits, appearance images, a source not in
 * memory), when they outgrow the IFC, or when asked (a version).
 */

import { BinaryCacheWriter, toCacheDataStore, type GeometryData } from '@ifc-lite/cache';
import { asSourceBytes, type IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import type { FederatedModel } from '@/store/types';
import { hasGeorefFields } from '@/lib/export/model-changes';
import { modelAppearanceAssets } from '@/lib/appearance/model-assets';
import { placementSourceIdentity } from '@/lib/model-placement/source-identity';
import { packageGeometryFrame } from './package-geometry';
import type { ModelDelta } from './model-delta';

export interface ModelBase {
  /** The IFC the model was loaded from (a copy: the parsed source can sit in shared memory). */
  bytes: Uint8Array;
  /** Its identity, the model's key in the package. */
  key: string;
  /** When it was first written to a package (ISO); the load cache validates its geometry against it. */
  savedAt?: string;
  /** Its meshes as a load-cache entry, once written or opened. */
  geometry?: Uint8Array | null;
}

const bases = new WeakMap<IfcDataStore, ModelBase>();

/** The loaded IFC of `store`, its identity, and what a package it came from knew of it. */
export async function modelBase(store: IfcDataStore): Promise<ModelBase | null> {
  const known = bases.get(store);
  if (known) return known;
  const source = store.source ? asSourceBytes(store.source) : null;
  if (!source || source.byteLength === 0 || !source.isResident) return null;
  const bytes = new Uint8Array(source.materialize());
  const key = await placementSourceIdentity(new Blob([bytes as BlobPart]), undefined, bytes);
  if (!key) return null;
  const base: ModelBase = { bytes, key };
  bases.set(store, base);
  return base;
}

/** What a package opened for `store` knew of its IFC (when written, its geometry). */
export function rememberPackageBase(store: IfcDataStore, base: ModelBase): void {
  bases.set(store, base);
}

/** Edits beyond this many changed entities (or a third of the model) are compacted into the IFC. */
const MAX_DELTA_ENTITIES = 20_000;

/** Why `model` is written as one IFC with its edits rather than its IFC plus a delta; null: as a delta. */
export function compactionReason(model: FederatedModel, delta: ModelDelta | null, forced: boolean): string | null {
  if (forced) return 'asked';
  if (!delta) return 'no overlay';
  if (hasGeorefFields(useViewerStore.getState().georefMutations.get(model.id))) return 'georeferencing edits';
  if (modelAppearanceAssets.hasResources(model.id)) return 'appearance images';
  const o = delta.overlay;
  const changed = o.newEntities.size + o.tombstones.size + o.attributeKeysByEntity.size + o.positionalAttrMutations.size;
  const limit = Math.max(MAX_DELTA_ENTITIES, (model.ifcDataStore?.entityCount ?? 0) / 3);
  return changed > limit ? `${changed} changed entities` : null;
}

/**
 * The meshes of the IFC `base` of `model` as a load-cache entry: the scene's,
 * less every element the delta changed (re-meshed when it is restored), over
 * the model's own tables (they index those same bytes). Null when the cache
 * would not serve them.
 */
export async function baseGeometry(model: FederatedModel, base: ModelBase, delta: ModelDelta): Promise<Uint8Array | null> {
  const frame = packageGeometryFrame(model, base.bytes);
  if (!frame || !model.ifcDataStore) return null;
  const changed = new Set<number>([...delta.touched, ...delta.overlay.newEntities.keys(), ...delta.overlay.tombstones, ...delta.meshMoves.map(([, id]) => id)]);
  // A merged mesh with a changed element in it cannot be split here.
  if (frame.meshes.some((m) => (m.entityIds?.length ?? 0) > 1 && m.entityIds!.some((id) => changed.has(id)))) return null;
  const meshes = frame.meshes.filter((m) => !changed.has(m.expressId));
  const data: GeometryData = {
    meshes,
    totalVertices: meshes.reduce((n, m) => n + m.positions.length / 3, 0),
    totalTriangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0),
    coordinateInfo: frame.coordinateInfo,
  };
  const entry = await new BinaryCacheWriter().write(toCacheDataStore(model.ifcDataStore), data, base.bytes.slice().buffer, {
    includeGeometry: true, compressGeometryChunksInWorker: true, omitSourceHash: true,
  });
  return new Uint8Array(entry);
}
