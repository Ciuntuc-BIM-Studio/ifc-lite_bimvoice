/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A model's EFFECTIVE building storeys — the parsed ones that were not
 * deleted, plus the ones created in this session — and adding / removing
 * levels through the model's undoable edit path.
 *
 * The parsed spatial hierarchy is never rebuilt for overlay edits, so new
 * storeys are read from the mutation view (they vanish on undo, come back
 * on redo); their `Elevation` is in the file's length unit and converted
 * back to metres.
 */

import { addStoreyToStore, fromNativeLength, resolveSpatialAnchor } from '@ifc-lite/create';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { modelEditTarget, recordModellingEdit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { mutationDenial } from '@/store/mutation-permission';
import type { StoreyInput } from './view-defaults';

export interface ModelLevel extends StoreyInput {
  expressId: number;
  /** Created in this session (an overlay entity), not parsed from the file. */
  created: boolean;
}

const unitScaleCache = new WeakMap<IfcDataStore, number>();

function lengthUnitScale(ds: IfcDataStore, referenceStorey: number | undefined): number {
  const cached = unitScaleCache.get(ds);
  if (cached !== undefined) return cached;
  if (referenceStorey === undefined) return 1;
  try {
    const scale = resolveSpatialAnchor(ds, referenceStorey).lengthUnitScale ?? 1;
    unitScaleCache.set(ds, scale);
    return scale;
  } catch (err) {
    console.warn('[project] could not resolve the model length unit; assuming metres', err);
    return 1;
  }
}

/** Every effective storey of a loaded model, unsorted. */
export function modelLevels(modelId: string): ModelLevel[] {
  const state = useViewerStore.getState();
  const ds = state.models.get(modelId)?.ifcDataStore;
  const hierarchy = ds?.spatialHierarchy;
  if (!ds || !hierarchy) return [];
  const view = state.mutationViews.get(modelId);
  const levels: ModelLevel[] = [];
  for (const id of hierarchy.byStorey.keys()) {
    if (view?.isDeleted(id)) continue;
    const renamed = view?.getAttributeMutationsForEntity(id).find((m) => m.name === 'Name')?.value;
    levels.push({
      expressId: id,
      name: (typeof renamed === 'string' && renamed) || ds.entities.getName(id) || `Storey #${id}`,
      elevation: hierarchy.storeyElevations.get(id) ?? 0,
      globalId: ds.entities.getGlobalId(id) || undefined,
      created: false,
    });
  }
  if (!view) return levels;
  const scale = lengthUnitScale(ds, levels[0]?.expressId);
  for (const entity of view.getNewEntities()) {
    if (entity.type.toUpperCase() !== 'IFCBUILDINGSTOREY' || view.isDeleted(entity.expressId)) continue;
    // Later edits of a created entity are positional overrides on top of its authored attributes.
    const overrides = view.getPositionalMutationsForEntity(entity.expressId);
    const at = (i: number) => (overrides?.has(i) ? overrides.get(i) : entity.attributes[i]);
    const [globalId, name, elevation] = [at(0), at(2), at(9)];
    levels.push({
      expressId: entity.expressId,
      name: typeof name === 'string' && name ? name : `Storey #${entity.expressId}`,
      elevation: typeof elevation === 'number' ? fromNativeLength({ lengthUnitScale: scale }, elevation) : 0,
      globalId: typeof globalId === 'string' ? globalId : undefined,
      created: true,
    });
  }
  return levels;
}

export type LevelEditResult = { ok: true; storeyId: number; globalId?: string } | { ok: false; error: string };

/** Add a storey at `elevation` metres to a model, framed like its nearest existing storey. One undo step. */
export function addModelLevel(modelId: string, name: string, elevation: number): LevelEditResult {
  const state = useViewerStore.getState();
  const denial = mutationDenial(state, modelId);
  if (denial) return { ok: false, error: denial };
  const target = modelEditTarget(state, modelId);
  if (!target) return { ok: false, error: `No model loaded for id "${modelId}"` };
  const existing = modelLevels(modelId);
  if (existing.length === 0) return { ok: false, error: 'The model has no storey to frame a new one on.' };
  const reference = existing.reduce((best, l) => (Math.abs(l.elevation - elevation) < Math.abs(best.elevation - elevation) ? l : best));
  try {
    const made = recordModellingEdit(useViewerStore, modelId, (_methods, draft) => {
      ensureStoreyPlacement(target.dataStore, draft, reference.expressId);
      const anchor = resolveSpatialAnchor(target.dataStore, reference.expressId, draft.getMutationView());
      return addStoreyToStore(target.dataStore, draft, anchor, { Name: name, Elevation: elevation });
    });
    return { ok: true, storeyId: made.storeyId, globalId: made.globalId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Rename a storey (its IFC `Name`). One undo step. */
export function renameModelLevel(modelId: string, storeyId: number, name: string): LevelEditResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'A level needs a name.' };
  const state = useViewerStore.getState();
  const denial = mutationDenial(state, modelId);
  if (denial) return { ok: false, error: denial };
  if (!modelEditTarget(state, modelId)) return { ok: false, error: `No model loaded for id "${modelId}"` };
  try {
    recordModellingEdit(useViewerStore, modelId, (_methods, draft) => {
      if (draft.getNewEntity(storeyId)) draft.setPositionalAttribute(storeyId, 2, trimmed);
      else draft.setAttribute(storeyId, 'Name', trimmed);
    });
    return { ok: true, storeyId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Remove a storey created in this session, if nothing was placed on it. One undo step. */
export function removeModelLevel(modelId: string, storeyId: number): LevelEditResult {
  const state = useViewerStore.getState();
  const level = modelLevels(modelId).find((l) => l.expressId === storeyId);
  if (!level) return { ok: false, error: 'No such storey.' };
  if (!level.created) return { ok: false, error: 'Only levels added in this session can be deleted for now.' };
  const target = modelEditTarget(state, modelId);
  if (!target) return { ok: false, error: `No model loaded for id "${modelId}"` };
  const hosted = state.models.get(modelId)?.ifcDataStore?.spatialHierarchy?.byStorey.get(storeyId) ?? [];
  if (hosted.length > 0) return { ok: false, error: 'This level still holds elements; move or delete them first.' };
  try {
    recordModellingEdit(useViewerStore, modelId, (_methods, draft) => {
      const view = draft.getMutationView();
      for (const entity of view.getNewEntities()) {
        if (entity.type.toUpperCase() !== 'IFCRELAGGREGATES') continue;
        const related = entity.attributes[5];
        if (Array.isArray(related) && related.length === 1 && related[0] === `#${storeyId}`) draft.removeEntity(entity.expressId);
      }
      draft.removeEntity(storeyId);
    });
    return { ok: true, storeyId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
