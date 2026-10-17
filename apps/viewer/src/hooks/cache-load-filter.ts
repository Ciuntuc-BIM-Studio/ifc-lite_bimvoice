/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Meshes a cache hit leaves out: a caller about to load a model (a project
 * whose geometry groups were unloaded when it was saved) says, for the load's
 * cache key, which meshes to keep; `loadFromCache` asks it per chunk, and the
 * caller takes the ids it dropped once the model is in. A load that is not a
 * cache hit never asks (its drops stay null).
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';

interface Filter { make: (store: IfcDataStore) => (mesh: MeshData) => boolean; keep?: (mesh: MeshData) => boolean; dropped: number[] | null }

const filters = new Map<string, Filter>();

/** Leave out of the next cache hit for `cacheKey` the meshes `make(store)` does not keep. */
export function setCacheLoadFilter(cacheKey: string, make: Filter['make']): void {
  filters.set(cacheKey, { make, dropped: null });
}

/** `meshes` (one cache chunk) less the ones left out for `cacheKey`. */
export function filterCachedMeshes(cacheKey: string, store: IfcDataStore, meshes: MeshData[]): MeshData[] {
  const filter = filters.get(cacheKey);
  if (!filter) return meshes;
  filter.keep ??= filter.make(store);
  filter.dropped ??= [];
  const kept: MeshData[] = [];
  for (const mesh of meshes) {
    if (filter.keep(mesh)) kept.push(mesh);
    else filter.dropped.push(mesh.expressId);
  }
  return kept;
}

/** The element ids the cache hit left out (null: there was none), the filter forgotten. */
export function takeCacheLoadDrops(cacheKey: string): number[] | null {
  const filter = filters.get(cacheKey);
  filters.delete(cacheKey);
  return filter?.dropped ? [...new Set(filter.dropped)] : null;
}
