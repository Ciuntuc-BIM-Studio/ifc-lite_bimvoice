/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LandXML in and out of the civil module: a corridor exports its alignment
 * and profile, the terrain it sits on and its finished-grade surface; a
 * LandXML file imports its surfaces as terrains and its alignments (with
 * their profiles) as corridors on the plan in front, with the default
 * assembly — the configurator takes it from there.
 */

import { buildCorridor, defaultAssembly, defaultDesign, finishedGradeSurface, readLandXml, Terrain, writeLandXml, type CorridorSpec } from '@ifc-lite/create';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import { storeyOfElement } from '@/project/effective-storey';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { addCorridorToStore, resolveSpatialAnchor } from '@ifc-lite/create';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { prepareTarget } from '@/project/contour-element';
import type { ProjectView } from '@/project/types';
import { createTerrain, terrainTin, type CorridorRef } from './corridor-element';

/** Download a corridor as LandXML 1.2. */
export function exportCorridorLandXml(ref: CorridorRef): void {
  const storeyId = storeyOfElement(ref.modelId, ref.corridorId);
  const tin = storeyId === null ? null : terrainTin(ref.modelId, storeyId, ref.spec.terrainGlobalId);
  const model = buildCorridor(ref.spec, tin ? new Terrain(tin) : null);
  const xml = writeLandXml({
    application: 'ifc-lite',
    surfaces: [...(tin ? [{ name: 'Existing ground', tin }] : []), { name: `${ref.spec.name} finished grade`, tin: finishedGradeSurface(model) }],
    alignments: [{ name: ref.spec.name, spec: ref.spec.alignment, profile: ref.spec.profile }],
  });
  downloadFile(xml, `${sanitizeFilename(ref.spec.name) || 'corridor'}.xml`, 'application/xml');
}

export interface LandXmlImportReport {
  terrains: number;
  corridors: number;
  warnings: string[];
}

/** Import a LandXML file's surfaces and alignments into the model behind the plan `view`. */
export function importLandXml(view: ProjectView, text: string): LandXmlImportReport | { error: string } {
  let doc;
  try {
    doc = readLandXml(text);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const report: LandXmlImportReport = { terrains: 0, corridors: 0, warnings: [] };
  let terrainGlobalId: string | null = null;
  for (const surface of doc.surfaces) {
    const made = createTerrain(view, surface.tin, surface.name);
    if (made.ok) { report.terrains++; terrainGlobalId ??= made.globalId; } else report.warnings.push(`${surface.name}: ${made.error}`);
  }
  if (doc.alignments.length === 0) return report;
  const ready = prepareTarget(view, 0);
  if (!ready.ok) return { error: ready.error };
  for (const a of doc.alignments) {
    report.warnings.push(...a.warnings.map((w) => `${a.name}: ${w}`));
    const tin = terrainTin(ready.modelId, ready.storeyId, terrainGlobalId);
    const spec: CorridorSpec = {
      name: a.name, alignment: a.spec,
      profile: a.profile ?? { pvis: [{ station: a.spec.startStation ?? 0, elevation: 0 }, { station: (a.spec.startStation ?? 0) + 1, elevation: 0 }] },
      assembly: defaultAssembly(), design: defaultDesign(), interval: 10, terrainGlobalId,
    };
    try {
      const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
        ensureStoreyPlacement(ds, editor, ready.storeyId);
        return addCorridorToStore(ds, editor, resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView()), spec, tin);
      });
      const hierarchy = ready.edit.dataStore.spatialHierarchy;
      if (hierarchy) {
        registerAuthoredElement(hierarchy, ready.storeyId, made.corridorId, 'IFCELEMENTASSEMBLY', a.name);
        for (const id of made.parts) hierarchy.elementToStorey.set(id, ready.storeyId);
      }
      void requestRemesh(useViewerStore.getState, ready.modelId, made.parts, 'created');
      report.corridors++;
    } catch (err) {
      report.warnings.push(`${a.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return report;
}
