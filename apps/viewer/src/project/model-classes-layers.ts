/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a view can filter its drawing by, across the loaded models: the IFC
 * classes of the elements drawn (with how many), and the IFC presentation
 * layers (`PresentationLayerIndex`, one per model store, rebuilt when its
 * edits change) — and the layers of one drawn element (renderer id).
 */

import { PresentationLayerIndex } from '@ifc-lite/create';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';

const indexes = new WeakMap<IfcDataStore, { count: number; index: PresentationLayerIndex }>();

function layerIndex(modelId: string): PresentationLayerIndex | null {
  const s = useViewerStore.getState();
  const store = s.models.get(modelId)?.ifcDataStore;
  if (!store) return null;
  const view = s.mutationViews.get(modelId) ?? null;
  const count = view?.getMutationCount() ?? 0;
  const known = indexes.get(store);
  if (known && known.count === count) return known.index;
  const index = new PresentationLayerIndex(store, view);
  indexes.set(store, { count, index });
  return index;
}

/** The IFC presentation layers of the element drawn as `renderId`; empty when it is on none. */
export function layersOfRenderId(renderId: number): readonly string[] {
  const ref = useViewerStore.getState().resolveGlobalIdFromModels(renderId);
  return ref ? layerIndex(ref.modelId)?.of(ref.expressId) ?? [] : [];
}

/** Every IFC presentation layer of the loaded models, by name. */
export function modelLayerNames(): string[] {
  const names = new Set<string>();
  for (const id of useViewerStore.getState().models.keys()) for (const n of layerIndex(id)?.names ?? []) names.add(n);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The IFC classes of the loaded models' drawn elements: upper case (the key), as the model spells it, and how many. */
export function modelClassCounts(): Array<[ifcClass: string, spelled: string, count: number]> {
  const counts = new Map<string, Set<number>>();
  const spelled = new Map<string, string>();
  for (const model of useViewerStore.getState().models.values()) {
    for (const mesh of model.geometryResult?.meshes ?? []) {
      const k = mesh.ifcType?.toUpperCase();
      // Type objects (their representation maps) and openings are not drawn as elements.
      if (!k || k.endsWith('TYPE') || k.endsWith('STYLE') || k === 'IFCOPENINGELEMENT') continue;
      let ids = counts.get(k);
      if (!ids) { counts.set(k, (ids = new Set())); spelled.set(k, mesh.ifcType ?? k); }
      ids.add(mesh.expressId);
    }
  }
  return [...counts].map(([k, ids]) => [k, spelled.get(k) ?? k, ids.size] as [string, string, number]).sort((a, b) => a[0].localeCompare(b[0]));
}
