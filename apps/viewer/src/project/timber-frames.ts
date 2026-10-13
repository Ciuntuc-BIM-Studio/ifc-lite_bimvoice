/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Timber-framed walls in the loaded models (`@ifc-lite/create`'s
 * timber-frame-store): the selected walls framed with a spec (or their frame
 * changed, or taken off), one undo step per model; and every later edit of a
 * framed wall — moved, resized, joined, a door or window placed, moved or
 * removed in it — rebuilds its frame in the same step (`registerCommitFollowUp`).
 */

import {
  defaultTimberFrame, readHostedFill, readTimberFrame, resolveSpatialAnchor, setTimberFrameInStore, syncTimberFrameInStore, type TimberFrameSpec,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { stashAndPruneEntityMesh } from '@/store/slices/mutation-mesh-stash';
import { registerCommitFollowUp } from '@/lib/commands/modeling/transaction';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { storeyOfElement } from './effective-storey';
import { ensureEditMode } from './edit-mode';

/** What "Timber frame" frames new walls with until changed in its dialog. */
export const frameDefaults: TimberFrameSpec = defaultTimberFrame();

/** The selected walls, by model (express ids). */
export function selectedWallsByModel(): Map<string, number[]> {
  const s = useViewerStore.getState();
  const picked = new Set<number>(s.selectedEntityIds ?? []);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) picked.add(s.selectedEntityId);
  const byModel = new Map<string, number[]>();
  for (const id of picked) {
    const ref = s.resolveGlobalIdFromModels(id);
    const type = ref ? (s.mutationViews.get(ref.modelId)?.getNewEntity(ref.expressId)?.type ?? s.models.get(ref.modelId)?.ifcDataStore?.entities.getTypeName(ref.expressId)) : null;
    if (!ref || !type || !/^IFCWALL(STANDARDCASE)?$/i.test(type)) continue;
    byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  return byModel;
}

/** The frame spec of the first selected framed wall, or null. */
export function selectedFrame(): TimberFrameSpec | null {
  const s = useViewerStore.getState();
  for (const [modelId, ids] of selectedWallsByModel()) {
    const dataStore = s.models.get(modelId)?.ifcDataStore;
    for (const id of ids) {
      const spec = dataStore ? readTimberFrame(dataStore, id, s.mutationViews.get(modelId) ?? null) : null;
      if (spec) return spec;
    }
  }
  return null;
}

export interface FrameReport {
  walls: number;
  /** Why some wall could not be framed (the first reason). */
  refused: string | null;
}

/** Frame the selected walls with `spec` (null: take their frame off). One undo step per model. */
export function frameSelectedWalls(spec: TimberFrameSpec | null): FrameReport {
  ensureEditMode();
  const report: FrameReport = { walls: 0, refused: null };
  for (const [modelId, ids] of selectedWallsByModel()) {
    runInspectorEdit(modelId, () => {
      const remesh: number[] = [];
      for (const id of ids) {
        const storeyId = storeyOfElement(modelId, id);
        if (storeyId === null) { report.refused ??= 'The wall is not on a storey.'; continue; }
        try {
          const done = recordModellingCommit(useViewerStore, modelId, (editor, ds) =>
            setTimberFrameInStore(ds, editor, resolveSpatialAnchor(ds, storeyId, editor.getMutationView()), id, spec));
          for (const gone of done.removed) stashAndPruneEntityMesh(useViewerStore.getState, useViewerStore.setState, modelId, gone);
          registerPieces(modelId, storeyId, done.remesh);
          remesh.push(...done.remesh);
          report.walls++;
        } catch (err) {
          report.refused ??= err instanceof Error ? err.message : String(err);
        }
      }
      return remesh;
    });
  }
  return report;
}

/** New pieces join their wall's storey in the spatial tree. */
function registerPieces(modelId: string, storeyId: number, ids: readonly number[]): void {
  const hierarchy = useViewerStore.getState().models.get(modelId)?.ifcDataStore?.spatialHierarchy;
  if (hierarchy) for (const id of ids) if (!hierarchy.elementToStorey.has(id)) hierarchy.elementToStorey.set(id, storeyId);
}

// A framed wall edited, or a door / window / opening in one, rebuilds its frame in the same step.
registerCommitFollowUp((_store, modelId, result) => {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  const view = s.mutationViews.get(modelId) ?? null;
  if (!dataStore) return [];
  const walls = new Set<number>();
  for (const id of new Set([...result.created, ...result.remesh])) {
    if (readTimberFrame(dataStore, id, view)) { walls.add(id); continue; }
    const host = readHostedFill(dataStore, id, view)?.hostId;
    if (host !== undefined && readTimberFrame(dataStore, host, view)) walls.add(host);
  }
  if (walls.size === 0) return [];
  try {
    const remesh: number[] = [];
    for (const wall of walls) {
      const storeyId = storeyOfElement(modelId, wall);
      if (storeyId === null) continue;
      const done = recordModellingCommit(useViewerStore, modelId, (editor, ds) =>
        syncTimberFrameInStore(ds, editor, resolveSpatialAnchor(ds, storeyId, editor.getMutationView()), wall));
      for (const gone of done.removed) stashAndPruneEntityMesh(useViewerStore.getState, useViewerStore.setState, modelId, gone);
      registerPieces(modelId, storeyId, done.remesh);
      remesh.push(...done.remesh);
    }
    return remesh;
  } catch (err) {
    // The edit stands; the frame follows on the next one.
    console.warn('[timber-frames] could not rebuild a frame after the commit', err);
    return [];
  }
});
