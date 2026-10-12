/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's materials written into the IFC models, so 3D, the drawings
 * and the exported file agree: each editable model's IfcMaterials of that
 * name get the row's surface colour and its hatches (section, plan and
 * front view), and the elements that show them are remeshed. Linked models
 * are references and keep their own colours. One undo step per model.
 */

import { elementsWithMaterials, materialsNamed, writeMaterialAppearance, type MaterialAppearance, type MaterialHatchStyle } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { ensureEditMode } from './edit-mode';
import { materialGraphics, normaliseMaterialName, projectMaterials } from './materials';
import type { MaterialViewGraphics } from './types';

const hatchOf = (g: MaterialViewGraphics | undefined): MaterialHatchStyle | undefined => {
  if (!g || (!g.hatch && !g.fill)) return undefined;
  const out: MaterialHatchStyle = {};
  if (g.hatch) out.pattern = g.hatch;
  if (g.hatch && g.hatchScale && g.hatchScale !== 1) out.scale = g.hatchScale;
  if (g.fill) out.background = g.fill;
  return out;
};

/** The appearance the project gives `name` (null when it has no row of its own). */
export function projectMaterialAppearance(name: string): MaterialAppearance | null {
  const own = projectMaterials().find((m) => normaliseMaterialName(m.name) === normaliseMaterialName(name));
  if (!own) return null;
  const section = materialGraphics(name, [own], 'section', null);
  const out: MaterialAppearance = {};
  if (own.color) out.color = own.color;
  const hatches: NonNullable<MaterialAppearance['hatches']> = {};
  const s = hatchOf(section.membrane ? undefined : { ...section, fill: own.fill ?? undefined });
  if (s) hatches.section = s;
  const plan = own.views?.plan ? hatchOf({ ...own, ...own.views.plan }) : undefined;
  if (plan) hatches.plan = plan;
  const front = hatchOf(own.views?.elevation);
  if (front) hatches.elevation = front;
  if (Object.keys(hatches).length) out.hatches = hatches;
  return out;
}

export interface MaterialPushReport { models: number; elements: number; refused: string[] }

/** Write the project's materials `names` into every editable model that has them. */
export function pushMaterials(names: readonly string[]): MaterialPushReport {
  const report: MaterialPushReport = { models: 0, elements: 0, refused: [] };
  const wanted = names.map((name) => ({ name, appearance: projectMaterialAppearance(name) })).filter((m) => m.appearance);
  if (wanted.length === 0) return report;
  const s = useViewerStore.getState();
  const targets = [...s.models].filter(([, model]) => model.ifcDataStore && !model.linked);
  const hits = targets.map(([modelId, model]) => {
    const view = s.mutationViews.get(modelId) ?? null;
    return { modelId, found: wanted.map((m) => ({ ...m, ids: materialsNamed(model.ifcDataStore!, view, m.name) })).filter((m) => m.ids.length) };
  }).filter((t) => t.found.length);
  if (hits.length === 0) return report;
  ensureEditMode();
  for (const { modelId, found } of hits) {
    let remeshed = 0;
    const ok = runInspectorEdit(modelId, (tx) => {
      recordModellingCommit(useViewerStore, modelId, (editor, store) => {
        for (const m of found) for (const id of m.ids) writeMaterialAppearance(store, editor, id, m.name, m.appearance!);
      }, tx.batchId);
      const ds = tx.store.models.get(modelId)?.ifcDataStore ?? null;
      const ids = elementsWithMaterials(ds, tx.store.mutationViews.get(modelId) ?? null, found.flatMap((m) => m.ids));
      remeshed = ids.length;
      return ids;
    });
    if (ok) { report.models++; report.elements += remeshed; } else report.refused.push(modelId);
  }
  return report;
}
