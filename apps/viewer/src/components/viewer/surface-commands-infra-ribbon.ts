/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Infrastructure tab commands: terrains (from survey points, from a
 * selected element's mesh, from LandXML), road corridors (drawn along a
 * polyline, configured, exported, deleted). Everything is built on the
 * floor plan in front, in the model behind it.
 */

import { parseSurveyPoints } from '@ifc-lite/create';
import { CivilCorridor, CivilDelete, CivilLandXmlIn, CivilLandXmlOut, CivilPoints, CivilRoad, CivilTerrain } from '@/icons';
import { resolve } from '@/i18n/registry';
import { toast } from '@/components/ui/toast';
import { isDrawingTabActive } from '@/project/document-tabs';
import { activeWorkPlane, startDraftCommand } from '@/drafting/session';
import { createTerrainFromPoints, createTerrainFromSelection } from '@/civil/corridor-element';
import { openCorridorForSelection, selectedCorridor } from '@/civil/corridor-dialog-store';
import { exportCorridorLandXml, importLandXml } from '@/civil/landxml-exchange';
import { deleteCorridorWithConfirm } from './civil/delete-corridor';
import { useViewerStore } from '@/store';
import type { SurfaceCommandDefinition } from './surface-command-types';

const ribbonOnly = ['ribbon'] as const;
const always = (): boolean => true;

/** The floor plan in front, or a toast saying one is needed. */
function plan() {
  const { view } = activeWorkPlane();
  if (!isDrawingTabActive() || !view || view.kind !== 'plan') {
    toast.info(resolve('civil.needsPlan'));
    return null;
  }
  return view;
}

function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const file = input.files?.[0];
      done(file ? { name: file.name, text: await file.text() } : null);
    };
    input.click();
  });
}

function road(): void {
  if (!isDrawingTabActive()) {
    toast.info(resolve('drafting.needsView'));
    return;
  }
  startDraftCommand('road');
}

async function terrainFromPoints(): Promise<void> {
  const view = plan();
  if (!view) return;
  const file = await pickTextFile('.csv,.txt,.xyz,.pts,text/plain,text/csv');
  if (!file) return;
  const points = parseSurveyPoints(file.text);
  if (points.length < 3) { toast.error(resolve('civil.noPoints')); return; }
  const made = createTerrainFromPoints(view, points, file.name.replace(/\.[^.]+$/, '') || 'Terrain');
  if (made.ok) toast.success(resolve('civil.terrainCreated', { count: points.length }));
  else toast.error(made.error);
}

function terrainFromSelection(): void {
  const view = plan();
  if (!view) return;
  const made = createTerrainFromSelection(view, 'Terrain');
  if (!made.ok) { toast.error(made.error); return; }
  const s = useViewerStore.getState();
  const triangles = (s.models.get(made.modelId)?.geometryResult?.meshes ?? []).filter((m) => m.expressId === made.elementId).reduce((n, m) => n + m.indices.length / 3, 0);
  toast.success(resolve('civil.terrainFromSelection', { triangles: Math.round(triangles) }));
}

async function importFile(): Promise<void> {
  const view = plan();
  if (!view) return;
  const file = await pickTextFile('.xml,application/xml,text/xml');
  if (!file) return;
  const report = importLandXml(view, file.text);
  if ('error' in report) { toast.error(report.error); return; }
  toast.success(resolve('civil.imported', { terrains: report.terrains, corridors: report.corridors }));
  if (report.warnings.length) toast.info(resolve('civil.importWarnings', { notes: report.warnings.slice(0, 3).join('; ') }));
}

/** The selected corridor (or the only one), else a toast. */
function corridorOrToast() {
  const ref = selectedCorridor();
  if (!ref) toast.info(resolve('civil.noSelection'));
  return ref;
}

export const RIBBON_INFRA_SURFACE_COMMANDS = [
  { id: 'infra:road', labelKey: 'civil.cmd.road', keywords: 'road corridor alignment polyline civil highway', category: 'Tools', icon: CivilRoad, surfaces: ribbonOnly, enabled: always, run: road },
  { id: 'infra:corridor', labelKey: 'civil.cmd.corridor', keywords: 'corridor configurator alignment profile assembly superelevation daylight cut fill', category: 'Tools', icon: CivilCorridor, surfaces: ribbonOnly, enabled: always, run: () => { if (!openCorridorForSelection()) toast.info(resolve('civil.noSelection')); } },
  { id: 'infra:delete-corridor', labelKey: 'civil.cmd.deleteCorridor', keywords: 'delete corridor road remove', category: 'Tools', icon: CivilDelete, surfaces: ribbonOnly, enabled: always, run: () => { const ref = corridorOrToast(); if (ref) void deleteCorridorWithConfirm(ref); } },
  { id: 'infra:terrain-points', labelKey: 'civil.cmd.terrainPoints', keywords: 'terrain survey points csv xyz penzd tin delaunay', category: 'Tools', icon: CivilPoints, surfaces: ribbonOnly, enabled: always, run: () => { void terrainFromPoints(); } },
  { id: 'infra:terrain-selection', labelKey: 'civil.cmd.terrainSelection', keywords: 'terrain from selection mesh surface landxml copy', category: 'Tools', icon: CivilTerrain, surfaces: ribbonOnly, enabled: always, run: terrainFromSelection },
  { id: 'infra:import-landxml', labelKey: 'civil.cmd.importLandXml', keywords: 'import landxml surface alignment profile', category: 'Tools', icon: CivilLandXmlIn, surfaces: ribbonOnly, enabled: always, run: () => { void importFile(); } },
  { id: 'infra:export-landxml', labelKey: 'civil.cmd.exportLandXml', keywords: 'export landxml corridor alignment profile surface', category: 'Tools', icon: CivilLandXmlOut, surfaces: ribbonOnly, enabled: always, run: () => { const ref = corridorOrToast(); if (ref) exportCorridorLandXml(ref); } },
] as const satisfies readonly SurfaceCommandDefinition[];
