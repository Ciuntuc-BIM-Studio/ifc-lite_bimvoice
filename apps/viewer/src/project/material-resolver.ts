/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The building materials of a view's drawing, read from the loaded models:
 * each cut band's IfcMaterial name (by its `materialId`, in the model its
 * element belongs to; an element of one material, that material) and each element's layer order, resolved against the
 * project's materials table. Cached per drawing until the models or the
 * table change. A plan draws its cut by the materials' plan graphics, any
 * other view by their section graphics.
 */

import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { liveEntityConforms, readRelatedLists } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { layerSetOf } from '@/lib/commands/modeling/authored-kinds';
import { useProjectStore } from './project-store';
import { materialDrawing, type LayerRef, type MaterialDrawing } from './material-drawing';
import { MEMBRANE_THICKNESS_M, ifcMaterialName, materialGraphics } from './materials';

function modelOf(entityId: number) {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(entityId);
  const model = ref ? s.models.get(ref.modelId) : undefined;
  return ref && model?.ifcDataStore ? { ...ref, dataStore: model.ifcDataStore, view: s.mutationViews.get(ref.modelId) ?? null } : null;
}

function materialName(m: NonNullable<ReturnType<typeof modelOf>>, materialId: number): string | null {
  return ifcMaterialName(m.dataStore, m.view, materialId);
}

/** Each element's single IfcMaterial (its own association, else its type's), per model, built once per drawing. */
function singleMaterials(m: NonNullable<ReturnType<typeof modelOf>>, built: Map<string, Map<number, number>>): Map<number, number> {
  const hit = built.get(m.modelId);
  if (hit) return hit;
  const out = new Map<number, number>();
  const isMaterial = (id: number) => liveEntityConforms(m.dataStore, id, 'IfcMaterial', m.view);
  // Elements and types alike: a type's material then reaches its occurrences that have none of their own.
  for (const rel of readRelatedLists(m.dataStore, 'IfcRelAssociatesMaterial', m.view)) {
    const material = rel.relatingId;
    if (material === undefined || !isMaterial(material)) continue;
    for (const id of rel.relatedIds) out.set(id, material);
  }
  for (const rel of readRelatedLists(m.dataStore, 'IfcRelDefinesByType', m.view)) {
    const material = rel.relatingId === undefined ? undefined : out.get(rel.relatingId);
    if (material !== undefined) for (const id of rel.relatedIds) if (!out.has(id)) out.set(id, material);
  }
  built.set(m.modelId, out);
  return out;
}

const cache = new WeakMap<Drawing2D, { key: string; value: MaterialDrawing }>();

/** The drawing's cut by building materials (null when nothing in it has a layered material), as a plan or a section draws it. */
export function viewMaterials(drawing: Drawing2D | null, viewKind?: string): MaterialDrawing | null {
  if (!drawing || drawing.cutPolygons.length === 0) return null;
  const table = useProjectStore.getState().materials ?? [];
  const kind = viewKind === 'plan' ? 'plan' : 'section';
  const key = `${kind}:${useViewerStore.getState().mutationVersion}:${JSON.stringify(table)}`;
  const hit = cache.get(drawing);
  if (hit && hit.key === key) return hit.value;
  const singles = new Map<string, Map<number, number>>();
  const value = materialDrawing(drawing, {
    graphics(p) {
      const m = modelOf(p.entityId);
      const materialId = m ? p.materialId ?? singleMaterials(m, singles).get(m.expressId) : undefined;
      const name = m && materialId !== undefined ? materialName(m, materialId) : null;
      return name ? materialGraphics(name, table, kind) : null;
    },
    layers(entityId) {
      const m = modelOf(entityId);
      const set = m ? layerSetOf({ dataStore: m.dataStore, view: m.view }, m.expressId) : null;
      if (!m || !set) return null;
      return set.layers.map((l): LayerRef => ({ materialId: l.materialId, name: (l.materialId !== null ? materialName(m, l.materialId) : null) ?? '', thickness: l.thickness }));
    },
    membrane: (layer) => layer.thickness < MEMBRANE_THICKNESS_M || (!!layer.name && !!materialGraphics(layer.name, table).membrane),
  });
  cache.set(drawing, { key, value });
  return value;
}
