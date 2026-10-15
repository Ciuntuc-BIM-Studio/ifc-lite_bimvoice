/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A project package's geometry (N4): at an explicit Save, the primary
 * model's meshes are written beside its IFC as a load-cache entry
 * (`models/<key>/geometry.bin`, the `@ifc-lite/cache` binary format) for
 * that IFC's bytes; opening the package puts it in the load cache under the
 * key the loader will look up, so the model opens without re-meshing, on any
 * machine. A reopened package (same machine) hits the cache its first open
 * wrote even without it.
 *
 * Only what the load cache serves: the primary model (no id offset), not
 * moved in the scene, an IFC between the cache's size bounds (a smaller one
 * meshes fast anyway). Its GPU-instanced occurrences are written as plain
 * meshes (the scene keeps them, not the model's geometry): the package opens
 * them drawn one by one. Anything else saves and opens as before.
 */

import { BinaryCacheWriter, computeSourceFingerprint, toCacheDataStore, type GeometryData } from '@ifc-lite/cache';
import { IfcParser } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { placementFor } from '@/lib/model-placement/state';
import { equalRotation, ZERO_ROTATION } from '@/lib/model-placement/rotation';
import type { FederatedModel } from '@/store/types';
import { resolveLoadTessellationTier } from '@/store/constants';
import { buildGeometryCacheKey } from '@/hooks/geometryCacheKey';
import { setCached } from '@/services/cacheService';
import { CACHE_MAX_SOURCE_SIZE, CACHE_SIZE_THRESHOLD } from '@/utils/ifcConfig';

export const packageGeometryPath = (modelKey: string) => `models/${modelKey}/geometry.bin`;

const servable = (bytes: Uint8Array) => bytes.byteLength >= CACHE_SIZE_THRESHOLD && bytes.byteLength <= CACHE_MAX_SOURCE_SIZE;

/** The key the loader looks `bytes` up under, with the session's load settings (as `useIfcLoader` builds it). */
export function loadCacheKey(bytes: Uint8Array): string {
  const s = useViewerStore.getState();
  const tier = resolveLoadTessellationTier(bytes.byteLength / (1024 * 1024), s.geometryMode);
  return buildGeometryCacheKey(bytes.byteLength, computeSourceFingerprint(bytes).hex, s.mergeLayers, undefined, s.geometryMode === 'fast', tier);
}

/** `model`'s meshes as a load-cache entry for its saved IFC `bytes`, or null when the cache would not serve it. */
export async function packageGeometry(model: FederatedModel, bytes: Uint8Array): Promise<Uint8Array | null> {
  const geometry = model.geometryResult;
  if (!geometry || (model.idOffset ?? 0) !== 0 || !servable(bytes)) return null;
  // The cache holds the load frame: a model moved in the scene would come back moved twice.
  const placement = placementFor(useViewerStore.getState().modelPlacement, model.id);
  if (placement.translation.some((v) => v !== 0) || !equalRotation(placement.rotation, ZERO_ROTATION)) return null;
  const instanced = geometry.instancedGeometryHashes?.size
    ? (getGlobalRenderer()?.getScene()?.getAllInstancedMeshData() ?? []).filter((m) => m.expressId > 0 && m.expressId <= (model.maxExpressId ?? Number.POSITIVE_INFINITY))
    : [];
  if (geometry.instancedGeometryHashes?.size && instanced.length === 0) return null;
  const meshes = instanced.length ? [...geometry.meshes, ...instanced] : geometry.meshes;
  // The entry's data tables index the SAVED bytes (ids are kept by the export, the offsets are not).
  const buffer = bytes.slice().buffer;
  const store = await new IfcParser().parseColumnar(buffer);
  const data: GeometryData = {
    meshes,
    totalVertices: meshes.reduce((n, m) => n + m.positions.length / 3, 0),
    totalTriangles: meshes.reduce((n, m) => n + m.indices.length / 3, 0),
    coordinateInfo: geometry.coordinateInfo,
  };
  const entry = await new BinaryCacheWriter().write(toCacheDataStore(store), data, buffer, {
    includeGeometry: true, compressGeometryChunksInWorker: true, omitSourceHash: true,
  });
  return new Uint8Array(entry);
}

/** Put a package model's geometry in the load cache for its IFC `bytes`, valid for a file of `lastModified`. */
export async function seedPackageGeometry(name: string, bytes: Uint8Array, geometry: Uint8Array, lastModified: number | undefined): Promise<void> {
  if (!servable(bytes)) return;
  try {
    const source = bytes.slice().buffer;
    await setCached(loadCacheKey(bytes), geometry.slice().buffer, name, bytes.byteLength, source, lastModified ? { lastModified } : undefined);
  } catch (err) {
    console.warn('[project] package geometry not cached', err);
  }
}
