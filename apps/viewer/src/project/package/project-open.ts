/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Opening a project package: everything loaded is closed, the native models
 * are loaded from their IFC in the package (one after another, the largest
 * first as the primary one) and their edits over it put back (N4b), and only then the project document is put in place — its views,
 * sheets, drafts and settings now refer to models that are there. Linked
 * models are reported back for the user to locate; loaded later with
 * `loadLinkedModel`, they are read-only.
 */

import { useViewerStore } from '@/store';
import { loadProjectDocument, resetProject } from '../project-store';
import type { PackageModel } from './format';
import { readPackage, unzipPackage, type OpenedPackage } from './package-io';
import { geometryGroupOf, loadCacheKey, packageGeometryGroupsPath, packageGeometryPath, seedPackageGeometry } from './package-geometry';
import { markUnloaded, registerGeometryGroups, setGeometryLoaded } from '../geometry-residency';
import { setCacheLoadFilter, takeCacheLoadDrops } from '@/hooks/cache-load-filter';
import { segment } from './format';
import { strFromU8 } from 'fflate';
import { clearCarriedDeltas, restoreModelDelta, type ModelDelta } from './model-delta';
import { decodeStructured } from './overlay-codec';
import { rememberPackageBase } from './package-base';

export interface ModelLoader {
  /** Close every loaded model (and reset the viewer). */
  clearAll: () => void;
  /** Load one model as a federated model; its id, or null when it did not load. */
  addModel: (file: File, options: { name: string }) => Promise<string | null>;
}

export interface OpenResult {
  opened: OpenedPackage;
  /** Native models that did not load. */
  failed: string[];
  /** Linked models to locate. */
  linked: PackageModel[];
}

/** A model opened with geometry groups unloaded: what the cache hit left out is marked so; a fresh load has them unloaded now. */
function leaveUnloaded(modelId: string, skip: ReadonlySet<string>, dropped: number[] | null): void {
  const model = useViewerStore.getState().models.get(modelId);
  const store = model?.ifcDataStore;
  if (!model || !store) return;
  const offset = model.idOffset ?? 0;
  if (dropped) { markUnloaded(dropped.map((id) => id + offset)); return; }
  const groupOf = geometryGroupOf(store);
  const ids = new Set<number>();
  for (const mesh of model.geometryResult?.meshes ?? []) if (skip.has(groupOf({ expressId: mesh.expressId - offset, ifcType: mesh.ifcType }))) ids.add(mesh.expressId);
  setGeometryLoaded([...ids], false);
}

/** The chunk groups a package wrote beside a model's geometry (none when unreadable). */
function readChunkGroups(bytes: Uint8Array): string[] {
  try {
    const parsed = JSON.parse(strFromU8(bytes)) as { chunks?: unknown };
    return Array.isArray(parsed.chunks) && parsed.chunks.every((c) => typeof c === 'string') ? parsed.chunks : [];
  } catch {
    return [];
  }
}

export async function openPackageBytes(bytes: Uint8Array, loader: ModelLoader, onProgress?: (label: string) => void): Promise<OpenResult> {
  // Read and check everything before closing what is open: a bad file leaves the session as it was.
  const files = unzipPackage(bytes);
  const opened = await readPackage(files);
  loader.clearAll();
  resetProject();
  clearCarriedDeltas();
  const failed: string[] = [];
  const restores: Array<{ id: string; delta: ModelDelta }> = [];
  // The largest model loads first, as the primary one: it streams onto the screen as it meshes and is
  // served from (and kept in) the load cache, with its saved geometry. Added after it, a model only
  // appears once fully loaded. The project's own first model is made active again once all are in.
  const natives = opened.models.filter((m) => m.model.role === 'native' && m.bytes);
  const order = [...natives].sort((a, b) => (b.bytes?.byteLength ?? 0) - (a.bytes?.byteLength ?? 0));
  const loadedIds = new Map<string, string>();
  for (const { model, bytes: ifc, overlay } of order) {
    if (model.role !== 'native' || !ifc) continue;
    onProgress?.(model.name);
    const name = model.name || `${model.id}.ifc`;
    // When its IFC was written stands for the model file's modified time: a reopened package then
    // finds the geometry in the load cache (whose hit is validated by that time).
    const savedAt = model.baseSavedAt ?? opened.manifest.savedAt;
    const lastModified = Date.parse(savedAt) || undefined;
    // Its saved meshes, put where the load looks for them: the model opens without re-meshing.
    const geometry = files.get(packageGeometryPath(segment(model.id)));
    if (geometry) await seedPackageGeometry(name, ifc, geometry, lastModified);
    // Its geometry groups unloaded when it was saved stay out: a cache hit never puts them in.
    const skip = new Set(opened.doc.unloadedGeometry?.[model.id] ?? []);
    const cacheKey = skip.size ? loadCacheKey(ifc) : '';
    if (skip.size) setCacheLoadFilter(cacheKey, (store) => { const groupOf = geometryGroupOf(store); return (mesh) => !skip.has(groupOf(mesh)); });
    const id = await loader.addModel(new File([ifc as BlobPart], name, lastModified ? { lastModified } : {}), { name });
    const dropped = skip.size ? takeCacheLoadDrops(cacheKey) : null;
    if (!id) { failed.push(model.name); continue; }
    if (skip.size) leaveUnloaded(id, skip, dropped);
    loadedIds.set(model.id, id);
    const store = useViewerStore.getState().models.get(id)?.ifcDataStore;
    // The next save writes this IFC again as it is, with what is known of it, and only the edits beside it.
    const groupsFile = files.get(packageGeometryGroupsPath(segment(model.id)));
    const groups = groupsFile ? readChunkGroups(groupsFile) : [];
    if (store) rememberPackageBase(store, { bytes: ifc, key: model.id, savedAt, ...(geometry ? { geometry: { entry: geometry, groups } } : {}) });
    // A group of its elements (a storey, an IFC class) unloaded and loaded again reads only its chunks.
    if (geometry && groups.length) registerGeometryGroups(id, loadCacheKey(ifc), groups);
    if (overlay) restores.push({ id, delta: decodeStructured(strFromU8(overlay)) as ModelDelta });
  }
  // Its edits over its IFC (N4b), once every model is in: what they re-mesh meshes against the loaded scene.
  for (const { id, delta } of restores) restoreModelDelta(delta, id);
  const first = natives[0] ? loadedIds.get(natives[0].model.id) : undefined;
  if (first && useViewerStore.getState().activeModelId !== first) useViewerStore.getState().setActiveModel(first);
  loadProjectDocument(opened.doc);
  return { opened, failed, linked: opened.models.filter((m) => m.model.role === 'linked').map((m) => m.model) };
}

/** Load a coordination model read-only. */
export async function loadLinkedModel(file: File, loader: Pick<ModelLoader, 'addModel'>): Promise<string | null> {
  const id = await loader.addModel(file, { name: file.name });
  if (id) useViewerStore.getState().updateModel(id, { linked: true });
  return id;
}
