/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The parametric curtain wall in the app (`curtain-wall-system.ts` in
 * @ifc-lite/create): find the curtain wall an element belongs to and its
 * spec — read back from its parts when it was placed before it kept one —,
 * apply a changed spec as one undo step, select it as one block (a click on
 * any mullion, transom or panel takes the whole curtain wall), and carry a
 * curtain wall type's changes to every curtain wall of that type.
 */

import { create } from 'zustand';
import {
  curtainWallOf, curtainWallParts, inferCurtainWallSpec, readCurtainWallSystem, regenerateCurtainWallInStore, resolveSpatialAnchor,
  type CurtainWallSpec, type CurtainWallTypeSpec,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { stashAndPruneEntityMesh } from '@/store/slices/mutation-mesh-stash';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { storeyOfElement } from './effective-storey';
import { ensureEditMode } from './edit-mode';
import { registerBlockResolver } from './element-groups';
import { ELEMENT_DOUBLE_CLICK_EVENT } from '@/components/viewer/selectionHandlers';
import { useProjectStore } from './project-store';

export interface CurtainWallRef {
  modelId: string;
  curtainWallId: number;
  spec: CurtainWallSpec;
  /** Read back from the parts (it kept no spec yet): applying it makes it parametric. */
  inferred: boolean;
}

function live(modelId: string) {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  return dataStore ? { s, dataStore, view: s.mutationViews.get(modelId) ?? null } : null;
}

/** A curtain wall of a model and its spec (kept, or read back from its parts); null when it is not one. */
export function curtainWallRef(modelId: string, elementId: number): CurtainWallRef | null {
  const l = live(modelId);
  if (!l) return null;
  let curtainWallId: number | null = null;
  try { curtainWallId = curtainWallOf(l.dataStore, elementId, l.view); } catch { curtainWallId = null; }
  if (curtainWallId === null) return null;
  const kept = readCurtainWallSystem(l.dataStore, curtainWallId, l.view);
  if (kept) return { modelId, curtainWallId, spec: kept, inferred: false };
  const storeyId = storeyOfElement(modelId, curtainWallId);
  if (storeyId === null) return null;
  try {
    const anchor = resolveSpatialAnchor(l.dataStore, storeyId, l.view ?? undefined);
    const spec = inferCurtainWallSpec(l.dataStore, anchor, curtainWallId, l.view);
    return spec ? { modelId, curtainWallId, spec, inferred: true } : null;
  } catch {
    return null;
  }
}

/** The curtain wall of a renderer id (the curtain wall or any of its parts). */
export function curtainWallOfRenderId(renderId: number): CurtainWallRef | null {
  const ref = useViewerStore.getState().resolveGlobalIdFromModels(renderId);
  return ref ? curtainWallRef(ref.modelId, ref.expressId) : null;
}

/** Regenerate a curtain wall from a changed spec, as one undo step; its parts re-mesh. */
export function applyCurtainWall(ref: Pick<CurtainWallRef, 'modelId' | 'curtainWallId'>, spec: CurtainWallSpec): { ok: true } | { ok: false; error: string } {
  ensureEditMode();
  const storeyId = storeyOfElement(ref.modelId, ref.curtainWallId);
  if (storeyId === null) return { ok: false, error: 'The curtain wall is not on a storey.' };
  try {
    const result = recordModellingCommit(useViewerStore, ref.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, storeyId);
      const anchor = resolveSpatialAnchor(ds, storeyId, editor.getMutationView());
      return regenerateCurtainWallInStore(ds, editor, anchor, ref.curtainWallId, spec);
    });
    const get = useViewerStore.getState;
    const set = useViewerStore.setState;
    for (const id of result.removed) stashAndPruneEntityMesh(get, set, ref.modelId, id);
    const hierarchy = get().models.get(ref.modelId)?.ifcDataStore?.spatialHierarchy;
    const view = get().mutationViews.get(ref.modelId);
    const created: number[] = [];
    const kept: number[] = [];
    for (const id of result.parts) {
      if (hierarchy && !hierarchy.elementToStorey.has(id)) {
        const panel = String(view?.getNewEntity(id)?.attributes[7] ?? '').startsWith('panel:');
        const name = view?.getNewEntity(id)?.attributes[2];
        registerAuthoredElement(hierarchy, storeyId, id, panel ? 'IFCPLATE' : 'IFCMEMBER', typeof name === 'string' ? name : '');
        created.push(id);
      } else kept.push(id);
    }
    if (created.length) void requestRemesh(get, ref.modelId, created, 'created');
    if (kept.length) void requestRemesh(get, ref.modelId, kept, 'shape');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────

/** A curtain wall type of the project catalogue, as it shapes a spec. */
export interface CurtainWallTypeRef { id: string; spec: CurtainWallTypeSpec; height: number }

/** The catalogue's current curtain wall type (what Curtain wall places), if one is set. */
export function currentCurtainWallType(): CurtainWallTypeRef | null {
  const s = useProjectStore.getState();
  const id = s.currentTypes?.curtainWall;
  const entry = id ? s.elementTypes?.find((t) => t.id === id && t.kind === 'curtainWall') : undefined;
  return entry && entry.kind === 'curtainWall' ? { id: entry.id, spec: entry.curtain, height: entry.height } : null;
}

/** A curtain wall's spec following a type: the type's grid, sections, panels and colours over its own line and height. */
export function specFromType(spec: CurtainWallSpec, type: CurtainWallTypeRef): CurtainWallSpec {
  return { ...spec, ...type.spec, typeId: type.id };
}

/** Every curtain wall of `typeId` in the loaded models. */
export function curtainWallsOfType(typeId: string): CurtainWallRef[] {
  const s = useViewerStore.getState();
  const out: CurtainWallRef[] = [];
  for (const [modelId, model] of s.models) {
    const store = model.ifcDataStore;
    if (!store) continue;
    const view = s.mutationViews.get(modelId) ?? null;
    const ids = new Set<number>(store.entityIndex.byType.get('IFCCURTAINWALL') ?? []);
    for (const e of view?.getNewEntitiesOfType('IfcCurtainWall') ?? []) ids.add(e.expressId);
    for (const id of ids) {
      if (view?.isDeleted(id)) continue;
      const spec = readCurtainWallSystem(store, id, view);
      if (spec?.typeId === typeId) out.push({ modelId, curtainWallId: id, spec, inferred: false });
    }
  }
  return out;
}

/** A curtain wall type changed: every curtain wall of it follows (each its own undo step). */
export function pushCurtainWallType(type: CurtainWallTypeRef): { updated: number; failed: string[] } {
  let updated = 0;
  const failed: string[] = [];
  for (const ref of curtainWallsOfType(type.id)) {
    const result = applyCurtainWall(ref, specFromType(ref.spec, type));
    if (result.ok) updated++;
    else failed.push(result.error);
  }
  return { updated, failed };
}

// ─── Selection as one block, and the configurator ─────────────────────────

/** A curtain wall selects whole: a click on any of its parts takes them all, the curtain wall inspected. */
function curtainWallBlock(renderId: number): { members: number[]; primary: number } | null {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const l = ref ? live(ref.modelId) : null;
  if (!ref || !l) return null;
  let curtainWallId: number | null = null;
  try { curtainWallId = curtainWallOf(l.dataStore, ref.expressId, l.view); } catch { curtainWallId = null; }
  if (curtainWallId === null) return null;
  const parts = curtainWallParts(l.dataStore, curtainWallId, l.view);
  return { members: parts.map((id) => toGlobalIdFromModels(s.models, ref.modelId, id)), primary: toGlobalIdFromModels(s.models, ref.modelId, curtainWallId) };
}

/** Which curtain wall the configurator edits (none: closed). */
export const useCurtainWallDialog = create<{ target: { modelId: string; curtainWallId: number } | null }>()(() => ({ target: null }));

export function openCurtainWallDialog(ref: Pick<CurtainWallRef, 'modelId' | 'curtainWallId'>): void {
  useCurtainWallDialog.setState({ target: { modelId: ref.modelId, curtainWallId: ref.curtainWallId } });
}

export function closeCurtainWallDialog(): void {
  useCurtainWallDialog.setState({ target: null });
}

let installed = false;
/** Mount once: curtain walls select as blocks, and a double click opens a curtain wall's configurator. */
export function installCurtainWallBlocks(): void {
  if (installed) return;
  installed = true;
  registerBlockResolver(curtainWallBlock);
  window.addEventListener(ELEMENT_DOUBLE_CLICK_EVENT, (e) => {
    const id = (e as CustomEvent<number>).detail;
    const ref = typeof id === 'number' ? curtainWallOfRenderId(id) : null;
    if (ref) openCurtainWallDialog(ref);
  });
}
