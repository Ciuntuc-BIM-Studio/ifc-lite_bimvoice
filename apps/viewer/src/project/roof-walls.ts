/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Walls under roofs (`@ifc-lite/create`'s wall-roof-trim), two ways:
 *
 *  - ATTACH: any wall attached to the roof over it rises to the roof and
 *    keeps only what is under it (Design › Attach to roof; Detach takes it
 *    back to a plain wall);
 *  - GABLE WALLS: the roof configurator puts a wall of a chosen type under
 *    every gable edge, at a set distance inside the outline, flipped if its
 *    layers face the wrong way; they are regenerated with the roof and leave
 *    with it.
 *
 * Either way the wall stays a wall (grips, joins, Flip, types) and its trim
 * is rebuilt after every edit of it (`registerCommitFollowUp`) and of its
 * roof (`syncRoofWallsInStore`, inside the roof's own step).
 */

import {
  addMaterialLayerSetUsageToStore, addWallToStore, assignMaterialInStore, assignTypeInStore, ensureCatalogTypeInStore, gableWallLines,
  readRelatedLists, readWallMetres, readWallRoofTrim, resizeWallInStore, resolveJoineryAnchor, roofOverWall, roofTrimmedWalls,
  setWallRoofTrimInStore, syncWallRoofTrimInStore, type RoofSystemSpec, type RoofTrimTop, type SpatialAnchor,
} from '@ifc-lite/create';
import type { StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { registerCommitFollowUp } from '@/lib/commands/modeling/transaction';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { catalogInput } from '@/element-types/model-sync';
import { elementType } from '@/element-types/catalog';
import { layersThickness } from '@/element-types/spec';
import { ensureEditMode } from './edit-mode';

const GABLE_WALL_NAME = 'Gable wall';

/** The selected walls, by model (express ids). */
function selectedWalls(): Map<string, number[]> {
  const s = useViewerStore.getState();
  const picked = new Set<number>(s.selectedEntityIds ?? []);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) picked.add(s.selectedEntityId);
  const byModel = new Map<string, number[]>();
  for (const id of picked) {
    const ref = s.resolveGlobalIdFromModels(id);
    const dataStore = ref ? s.models.get(ref.modelId)?.ifcDataStore : null;
    const view = ref ? s.mutationViews.get(ref.modelId) : null;
    const type = ref ? (view?.getNewEntity(ref.expressId)?.type ?? dataStore?.entities.getTypeName(ref.expressId)) : null;
    if (!ref || !type || !/^IFCWALL(STANDARDCASE)?$/i.test(type)) continue;
    byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  return byModel;
}

export interface AttachReport {
  attached: number;
  /** Walls with no roof system over them. */
  noRoof: number;
}

/** Attach the selected walls to the roof over each (cut under its covering, up to the sheathing, or under its structure). One undo step per model. */
export function attachSelectedWallsToRoof(top: RoofTrimTop = 'covering'): AttachReport {
  ensureEditMode();
  const report: AttachReport = { attached: 0, noRoof: 0 };
  for (const [modelId, ids] of selectedWalls()) {
    runInspectorEdit(modelId, () => recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
      const anchor = resolveJoineryAnchor(ds, editor.getMutationView());
      const changed: number[] = [];
      for (const id of ids) {
        const roof = readWallRoofTrim(ds, id, editor.getMutationView())?.roof ?? roofOverWall(ds, editor, id);
        if (!roof) { report.noRoof++; continue; }
        setWallRoofTrimInStore(ds, editor, anchor, id, { roof, top });
        changed.push(id);
      }
      report.attached += changed.length;
      return changed;
    }));
  }
  return report;
}

/** Detach the selected walls from their roofs: plain walls again, as high as the roof had made them. */
export function detachSelectedWalls(): number {
  ensureEditMode();
  let count = 0;
  for (const [modelId, ids] of selectedWalls()) {
    runInspectorEdit(modelId, () => recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
      const anchor = resolveJoineryAnchor(ds, editor.getMutationView());
      const attached = ids.filter((id) => readWallRoofTrim(ds, id, editor.getMutationView()) !== null);
      for (const id of attached) setWallRoofTrimInStore(ds, editor, anchor, id, null);
      count += attached.length;
      return attached;
    }));
  }
  return count;
}

/** Whether a wall (model-local id) is attached to a roof. */
export function wallRoofTrim(modelId: string, expressId: number) {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  return dataStore ? readWallRoofTrim(dataStore, expressId, s.mutationViews.get(modelId) ?? null) : null;
}

export interface RoofWallsSync {
  /** Walls whose body changed, to re-mesh. */
  remesh: number[];
  /** Gable walls made now (to register on the storey and mesh as new). */
  created: number[];
  /** Gable walls the roof no longer has (to delete after the roof's commit). */
  remove: number[];
}

/** Type a new gable wall by the project wall type `typeId` (its type and layer set), inside the caller's commit. */
function typeWall(ds: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, wallId: number, typeId: string | undefined): void {
  const spec = elementType(typeId);
  const input = spec?.kind === 'wall' ? catalogInput(spec) : null;
  if (!spec || spec.kind !== 'wall' || !input) return;
  const view = editor.getMutationView();
  const type = ensureCatalogTypeInStore(ds, editor, resolveJoineryAnchor(ds, view), input);
  assignTypeInStore(editor, anchor, type.typeId, [wallId], readRelatedLists(ds, 'IfcRelDefinesByType', view));
  if (type.layerSetId === null) return;
  const { usageId } = addMaterialLayerSetUsageToStore(editor, anchor, { ForLayerSet: type.layerSetId, LayerSetDirection: 'AXIS2', OffsetFromReferenceLine: -layersThickness(spec.layers) / 2 });
  assignMaterialInStore(editor, anchor, usageId, [wallId], readRelatedLists(ds, 'IfcRelAssociatesMaterial', view));
}

/** A gable wall's thickness: its type's layers, else the spec's own. */
export function gableWallThickness(spec: NonNullable<RoofSystemSpec['gableWalls']>): number {
  const type = elementType(spec.typeId);
  return type?.kind === 'wall' && type.layers.length ? layersThickness(type.layers) : spec.thickness;
}

/**
 * Inside a roof system's commit (after it was written or regenerated): its
 * gable walls brought in line with `spec.gableWalls` — moved, made or marked
 * for removal — and every wall attached to it re-trimmed.
 */
export function syncRoofWallsInStore(ds: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, roofGlobalId: string, spec: RoofSystemSpec): RoofWallsSync {
  const view = editor.getMutationView();
  const out: RoofWallsSync = { remesh: [], created: [], remove: [] };
  const gable = spec.gableWalls?.enabled ? spec.gableWalls : null;
  const attached = roofTrimmedWalls(ds, view, roofGlobalId);
  const existing = new Map(attached.filter((w) => w.trim.gable !== undefined).map((w) => [w.trim.gable!, w.wallId]));
  const kept = new Set<number>();
  if (gable) {
    const thickness = gableWallThickness(gable);
    for (const line of gableWallLines(spec, thickness, gable.offset, gable.flip)) {
      const trim = { roof: roofGlobalId, top: gable.top, gable: line.edge };
      let wallId = existing.get(line.edge) ?? null;
      const metres = wallId === null ? null : readWallMetres({ dataStore: ds, view, editor }, wallId);
      if (wallId !== null && metres && Math.abs(metres.thickness - thickness) < 1e-6
        && resizeWallInStore({ dataStore: ds, view, editor }, wallId, line.start, line.end).ok) {
        kept.add(wallId);
        setWallRoofTrimInStore(ds, editor, anchor, wallId, trim);
        out.remesh.push(wallId);
        continue;
      }
      // New, or another thickness (another type): a new wall, the old one removed.
      if (wallId !== null) out.remove.push(wallId);
      wallId = addWallToStore(editor, anchor, { Start: line.start, End: line.end, Thickness: thickness, Height: line.height, Name: GABLE_WALL_NAME }).wallId;
      typeWall(ds, editor, anchor, wallId, gable.typeId);
      setWallRoofTrimInStore(ds, editor, anchor, wallId, trim);
      kept.add(wallId);
      out.created.push(wallId);
    }
  }
  for (const [, wallId] of existing) if (!kept.has(wallId) && !out.remove.includes(wallId)) out.remove.push(wallId);
  // Every other wall on this roof follows the roof's new shape.
  for (const { wallId, trim } of attached) {
    if (trim.gable !== undefined) continue;
    if (syncWallRoofTrimInStore(ds, editor, wallId)) out.remesh.push(wallId);
  }
  return out;
}

/** After the roof's commit: the gable walls it made join their storey in the spatial tree. */
export function registerGableWalls(modelId: string, storeyId: number, ids: readonly number[]): void {
  const hierarchy = useViewerStore.getState().models.get(modelId)?.ifcDataStore?.spatialHierarchy;
  if (!hierarchy) return;
  for (const id of ids) if (!hierarchy.elementToStorey.has(id)) registerAuthoredElement(hierarchy, storeyId, id, 'IFCWALL', GABLE_WALL_NAME);
}

/** Before a roof is deleted: its gable walls (to delete with it) and its other walls detached, inside the caller's commit. */
export function releaseRoofWallsInStore(ds: IfcDataStore, editor: StoreEditor, anchor: Pick<SpatialAnchor, 'ownerHistoryId' | 'guidRandom'>, roofGlobalId: string): { gableWalls: number[]; detached: number[] } {
  const attached = roofTrimmedWalls(ds, editor.getMutationView(), roofGlobalId);
  const detached = attached.filter((w) => w.trim.gable === undefined).map((w) => w.wallId);
  for (const id of detached) setWallRoofTrimInStore(ds, editor, anchor, id, null);
  return { gableWalls: attached.filter((w) => w.trim.gable !== undefined).map((w) => w.wallId), detached };
}

// A wall edited (moved, resized, flipped, retyped) keeps its roof trim, in the same step.
registerCommitFollowUp((_store, modelId, result) => {
  const ids = [...new Set([...result.created, ...result.remesh])];
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  const view = s.mutationViews.get(modelId) ?? null;
  if (!dataStore || ids.length === 0) return [];
  const trimmed = ids.filter((id) => readWallRoofTrim(dataStore, id, view) !== null);
  if (trimmed.length === 0) return [];
  try {
    return recordModellingCommit(useViewerStore, modelId, (editor, ds) => trimmed.filter((id) => syncWallRoofTrimInStore(ds, editor, id)));
  } catch (err) {
    // The edit stands; the trim follows on the next one.
    console.warn('[roof-walls] could not re-trim after the commit', err);
    return [];
  }
});
