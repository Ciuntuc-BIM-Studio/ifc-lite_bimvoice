/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry kept in memory or not, by group (a storey, an IFC class in it):
 * "Unload geometry" drops the elements' meshes from the scene (GPU) and from
 * the models' geometry (`setPendingMeshRemovals`, drained by
 * `useMeshEditDrain`); they stay in the model — properties, selection in the
 * tree, export — only not drawn. "Load geometry" meshes them again from the
 * load cache (the package's geometry or the load's own entry), reading
 * only the chunks of the groups asked for when a package said which group
 * each chunk holds, or meshed again from the model (`requestRemesh`) when
 * the cache has none. Session state, by renderer id.
 */

import { create } from 'zustand';
import { useViewerStore } from '@/store';
import { BinaryCacheReader, openGeometryChunksV13, SectionType } from '@ifc-lite/cache';
import type { MeshData } from '@ifc-lite/geometry';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { getCached } from '@/services/cacheService';
import { geometryGroupOf, loadCacheKey } from './package/package-geometry';

interface ResidencyState {
  /** Renderer ids whose geometry is unloaded. */
  unloaded: ReadonlySet<number>;
}

export const useGeometryResidency = create<ResidencyState>(() => ({ unloaded: new Set() }));

/** Per model: its load-cache key and the group of each geometry chunk (a package's `geometry-groups.json`). */
const groupIndexes = new Map<string, { cacheKey: string; chunks: readonly string[] }>();

export function registerGeometryGroups(modelId: string, cacheKey: string, chunks: readonly string[]): void {
  groupIndexes.set(modelId, { cacheKey, chunks });
}

/**
 * Put `expressIds`' meshes back from the load cache: only their groups'
 * chunks when the chunk groups are known, else every chunk, keeping only
 * theirs. The ids it found none for (null: no cache entry for the model).
 */
async function reloadFromCache(modelId: string, expressIds: number[]): Promise<number[] | null> {
  const s = useViewerStore.getState();
  const model = s.models.get(modelId);
  const store = model?.ifcDataStore;
  // The load cache holds the primary model only (no id offset).
  if (!model || !store || (model.idOffset ?? 0) !== 0) return null;
  const known = groupIndexes.get(modelId);
  const cached = await getCached(known?.cacheKey ?? loadCacheKey(store.source.materialize()));
  if (!cached) return null;
  const buffer = cached.buffer instanceof Blob ? await cached.buffer.arrayBuffer() : cached.buffer;
  const header = new BinaryCacheReader().readHeader(buffer);
  const section = header.sections.find((x) => x.type === SectionType.Geometry);
  if (!section || !header.hasGeometry) return null;
  const open = openGeometryChunksV13(buffer, section.offset, header.version);
  const want = new Set(expressIds);
  let chunks = open.chunks.map((_c, i) => i);
  if (known && known.chunks.length === open.chunks.length) {
    const groupOf = geometryGroupOf(store);
    const groups = new Set(expressIds.map((id) => groupOf({ expressId: id, ifcType: store.entities.getTypeName(id) })));
    chunks = chunks.filter((i) => groups.has(known.chunks[i]));
  }
  const byId = new Map<number, MeshData[]>();
  for (const i of chunks) {
    for (const mesh of await open.readChunk(i)) {
      if (!want.has(mesh.expressId)) continue;
      const list = byId.get(mesh.expressId);
      if (list) list.push(mesh); else byId.set(mesh.expressId, [mesh]);
    }
  }
  if (byId.size) useViewerStore.getState().replaceEntityMeshes(modelId, byId);
  return expressIds.filter((id) => !byId.has(id));
}

/** The row action a group of elements (renderer ids) takes: unload while any is loaded, else load. */
export function residencyActions(ids: readonly number[]): Array<'unload' | 'load'> {
  if (ids.length === 0) return [];
  const { unloaded } = useGeometryResidency.getState();
  return [ids.every((id) => unloaded.has(id)) ? 'load' : 'unload'];
}

/** Whether the element drawn as `renderId` has its geometry unloaded. */
export const isUnloaded = (renderId: number): boolean => useGeometryResidency.getState().unloaded.has(renderId);

/** Unload (`load` false) or load the geometry of `ids` (renderer ids). */
export function setGeometryLoaded(ids: readonly number[], load: boolean): void {
  const s = useViewerStore.getState();
  const unloaded = new Set(useGeometryResidency.getState().unloaded);
  if (!load) {
    const drop = ids.filter((id) => !unloaded.has(id));
    if (drop.length === 0) return;
    for (const id of drop) unloaded.add(id);
    useGeometryResidency.setState({ unloaded });
    s.setPendingMeshRemovals(new Set(drop));
    return;
  }
  const byModel = new Map<string, number[]>();
  for (const id of ids) {
    if (!unloaded.delete(id)) continue;
    const ref = s.resolveGlobalIdFromModels(id);
    if (!ref) continue;
    byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  useGeometryResidency.setState({ unloaded });
  for (const [modelId, expressIds] of byModel) void reloadModel(modelId, expressIds);
}

/** From the load cache where it has them; the rest meshed again from the model. */
async function reloadModel(modelId: string, expressIds: number[]): Promise<void> {
  let rest: number[] | null = null;
  try {
    rest = await reloadFromCache(modelId, expressIds);
  } catch (err) {
    console.warn('[geometry] reload from the cache failed, meshing again', err);
  }
  const remesh = rest ?? expressIds;
  if (remesh.length) await requestRemesh(useViewerStore.getState, modelId, remesh, 'shape');
}
