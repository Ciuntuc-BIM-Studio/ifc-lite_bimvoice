/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Foundations in the app (`strip-foundation.ts`, `pad-footing.ts` in
 * @ifc-lite/create): what the place commands build from the current type
 * (each layer and the concrete with the project's material appearance),
 * a type's changes carried to every foundation of it, a strip foundation
 * selected as one block (its foundation wall and footing), and the stems of
 * a chain joined at their corners like walls.
 */

import {
  addPadFootingToStore, addStripFoundationToStore, DEFAULT_CONCRETE, DEFAULT_PAD_FOOTING, DEFAULT_STRIP_FOUNDATION, joinWallsInStore,
  readPadFooting, readStripFoundation, regeneratePadFootingInStore, regenerateStripFoundationInStore, resolveSpatialAnchor, resolveWallJoinAnchor,
  stripFoundationOf, stripFoundationParts,
  type FoundationMaterial, type PadFootingSpec, type PadFootingType, type StripFoundationSpec, type StripFoundationType,
} from '@ifc-lite/create';
import { iterateEffectiveEntityIds, type StoreEditor } from '@ifc-lite/mutations';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { mutationDenial } from '@/store/mutation-permission';
import { modelEditTarget, recordModellingCommit, recordModellingEdit, type ModellingStore } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { addElementType, currentType, setCurrentType, typesOfKind } from '@/element-types/catalog';
import type { ElementTypeSpec, PadFootingTypeSpec, StripFoundationTypeSpec } from '@/element-types/spec';
import { storeyOfElement } from './effective-storey';
import { ensureEditMode } from './edit-mode';
import { registerBlockResolver } from './element-groups';
import { projectMaterialAppearance } from './material-ifc-sync';

/** A material as the project draws it (its colour and hatches), when it defines one. */
function withAppearance<T extends FoundationMaterial>(m: T): T {
  const appearance = projectMaterialAppearance(m.name);
  return appearance ? { ...m, appearance } : m;
}

export function stripTypeOf(entry: StripFoundationTypeSpec | null): StripFoundationType {
  const d = DEFAULT_STRIP_FOUNDATION;
  return {
    typeId: entry?.id ?? 'lapin-strip-foundation', name: entry?.name ?? 'Strip foundation',
    layers: (entry?.layers ?? d.layers).map((l) => withAppearance({ ...l })),
    stemHeight: entry?.stemHeight ?? d.stemHeight, footingWidth: entry?.footingWidth ?? d.footingWidth,
    footingHeight: entry?.footingHeight ?? d.footingHeight, bottom: entry?.bottom ?? d.bottom,
    concrete: withAppearance({ ...DEFAULT_CONCRETE }),
  };
}

export function padTypeOf(entry: PadFootingTypeSpec | null): PadFootingType {
  return {
    typeId: entry?.id ?? 'lapin-pad-footing', name: entry?.name ?? 'Pad footing',
    steps: (entry?.steps ?? DEFAULT_PAD_FOOTING.steps).map((s) => ({ ...s })), bottom: entry?.bottom ?? DEFAULT_PAD_FOOTING.bottom,
    concrete: withAppearance({ ...DEFAULT_CONCRETE }),
  };
}

/**
 * The catalogue entry a foundation tool places: the current one, else the
 * first of its kind, else a new default entry made current (so what is
 * placed can be edited, and followed, from Element types).
 */
function entryOf<K extends 'stripFoundation' | 'padFooting'>(kind: K): Extract<ElementTypeSpec, { kind: K }> | null {
  return currentType(kind) ?? typesOfKind(kind)[0] ?? null;
}

/** When a foundation tool starts: its kind has a current entry (a default one made when there is none). */
export function ensureFoundationType(kind: 'stripFoundation' | 'padFooting'): void {
  if (entryOf(kind)) return;
  setCurrentType(kind, addElementType(kind));
}

export const currentStripFoundationType = (): StripFoundationType => stripTypeOf(entryOf('stripFoundation'));
export const currentPadFootingType = (): PadFootingType => padTypeOf(entryOf('padFooting'));

type Built<T> = T | { error: string };

/** `build` against the storey's anchor as one recorded edit; what it made listed on the storey. */
function onStorey<T>(store: ModellingStore, modelId: string, storeyId: number, build: (editor: StoreEditor, anchor: ReturnType<typeof resolveSpatialAnchor>) => T): Built<T> {
  const denial = mutationDenial(store.getState(), modelId);
  if (denial) return { error: denial };
  const target = modelEditTarget(store.getState(), modelId);
  if (!target) return { error: `No model loaded for id "${modelId}"` };
  try {
    return recordModellingEdit(store, modelId, (_methods, draft) => {
      ensureStoreyPlacement(target.dataStore, draft, storeyId);
      return build(draft, resolveSpatialAnchor(target.dataStore, storeyId, draft.getMutationView()));
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function listOnStorey(store: ModellingStore, modelId: string, storeyId: number, ids: readonly [number, string][]): void {
  const target = modelEditTarget(store.getState(), modelId);
  const hierarchy = target?.dataStore.spatialHierarchy;
  if (!target || !hierarchy) return;
  for (const [id, ifcType] of ids) {
    const name = target.view.getNewEntity(id)?.attributes?.[2];
    registerAuthoredElement(hierarchy, storeyId, id, ifcType, typeof name === 'string' ? name : '');
  }
}

export function addStripFoundationIn(store: ModellingStore, modelId: string, storeyId: number, spec: StripFoundationSpec): Built<{ foundationId: number; stemId: number; footingId: number }> {
  const made = onStorey(store, modelId, storeyId, (editor, anchor) => {
    const target = modelEditTarget(store.getState(), modelId)!;
    return addStripFoundationToStore(target.dataStore, editor, anchor, spec);
  });
  if ('error' in made) return made;
  listOnStorey(store, modelId, storeyId, [[made.foundationId, 'IFCELEMENTASSEMBLY'], [made.stemId, 'IFCWALL'], [made.footingId, 'IFCFOOTING']]);
  return made;
}

export function addPadFootingIn(store: ModellingStore, modelId: string, storeyId: number, spec: PadFootingSpec): Built<{ footingId: number }> {
  const made = onStorey(store, modelId, storeyId, (editor, anchor) => addPadFootingToStore(modelEditTarget(store.getState(), modelId)!.dataStore, editor, anchor, spec));
  if ('error' in made) return made;
  listOnStorey(store, modelId, storeyId, [[made.footingId, 'IFCFOOTING']]);
  return made;
}

/**
 * Join two foundation walls at the corner of a chain (only each other: a
 * stem never joins the walls of the storey above it). The walls to re-mesh;
 * none when they cannot meet.
 */
export function joinStemsIn(store: ModellingStore, modelId: string, a: number, b: number): number[] {
  try {
    return recordModellingCommit(store, modelId, (editor, ds) => {
      joinWallsInStore(editor, ds, resolveWallJoinAnchor(ds, editor.getMutationView()), a, b);
      return [a, b];
    });
  } catch (err) {
    console.warn(`[foundations] stems #${a} and #${b} left unjoined:`, err);
    return [];
  }
}

// ─── Foundations in the model, and their types ─────────────────────────────

export type FoundationRef =
  | { family: 'strip'; modelId: string; id: number; spec: StripFoundationSpec }
  | { family: 'pad'; modelId: string; id: number; spec: PadFootingSpec };

function live(modelId: string) {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  return dataStore ? { s, dataStore, view: s.mutationViews.get(modelId) ?? null } : null;
}

/** The foundation an element of a model is (or is part of). */
export function foundationRef(modelId: string, elementId: number): FoundationRef | null {
  const l = live(modelId);
  if (!l) return null;
  try {
    const pad = readPadFooting(l.dataStore, elementId, l.view);
    if (pad) return { family: 'pad', modelId, id: elementId, spec: pad };
    const strip = stripFoundationOf(l.dataStore, elementId, l.view);
    const spec = strip === null ? null : readStripFoundation(l.dataStore, strip, l.view);
    return strip !== null && spec ? { family: 'strip', modelId, id: strip, spec } : null;
  } catch {
    return null;
  }
}

export function foundationOfRenderId(renderId: number): FoundationRef | null {
  const ref = useViewerStore.getState().resolveGlobalIdFromModels(renderId);
  return ref ? foundationRef(ref.modelId, ref.expressId) : null;
}

/** Every foundation in the loaded models. */
export function foundations(): FoundationRef[] {
  const s = useViewerStore.getState();
  const out: FoundationRef[] = [];
  for (const [modelId, model] of s.models) {
    const ds = model.ifcDataStore;
    if (!ds) continue;
    const view = s.mutationViews.get(modelId) ?? null;
    for (const { expressId } of iterateEffectiveEntityIds(ds, view, ['IFCELEMENTASSEMBLY', 'IFCFOOTING'])) {
      const ref = foundationRef(modelId, expressId);
      if (ref && ref.id === expressId) out.push(ref);
    }
  }
  return out;
}

/** Regenerate a foundation to a type (its own place kept), as one undo step; it re-meshes. */
export function applyFoundationType(ref: FoundationRef, type: StripFoundationType | PadFootingType): { ok: true } | { ok: false; error: string } {
  ensureEditMode();
  const storeyId = storeyOfElement(ref.modelId, ref.id);
  if (storeyId === null) return { ok: false, error: 'The foundation is not on a storey.' };
  try {
    const remesh = recordModellingCommit(useViewerStore, ref.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, storeyId);
      const anchor = resolveSpatialAnchor(ds, storeyId, editor.getMutationView());
      if (ref.family === 'strip') return regenerateStripFoundationInStore(ds, editor, anchor, ref.id, { ...ref.spec, ...(type as StripFoundationType) }).remesh;
      regeneratePadFootingInStore(ds, editor, anchor, ref.id, { ...ref.spec, ...(type as PadFootingType) });
      return [ref.id];
    });
    void requestRemesh(useViewerStore.getState, ref.modelId, remesh, 'shape');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A foundation type changed: every foundation of it follows (each its own undo step). */
export function pushFoundationType(entry: StripFoundationTypeSpec | PadFootingTypeSpec): { updated: number; failed: string[] } {
  const family = entry.kind === 'stripFoundation' ? 'strip' : 'pad';
  const type = entry.kind === 'stripFoundation' ? stripTypeOf(entry) : padTypeOf(entry);
  let updated = 0;
  const failed: string[] = [];
  for (const ref of foundations()) {
    if (ref.family !== family || ref.spec.typeId !== entry.id) continue;
    const result = applyFoundationType(ref, type);
    if (result.ok) updated++;
    else failed.push(result.error);
  }
  return { updated, failed };
}

/** The selected foundations of the entry's kind take its type. */
export function applyFoundationTypeToSelection(entry: StripFoundationTypeSpec | PadFootingTypeSpec, renderIds: Iterable<number>): { updated: number; refused: string[] } {
  const family = entry.kind === 'stripFoundation' ? 'strip' : 'pad';
  const type = entry.kind === 'stripFoundation' ? stripTypeOf(entry) : padTypeOf(entry);
  const done = new Set<string>();
  const out = { updated: 0, refused: [] as string[] };
  for (const id of renderIds) {
    const ref = foundationOfRenderId(id);
    if (!ref || ref.family !== family || done.has(`${ref.modelId}:${ref.id}`)) continue;
    done.add(`${ref.modelId}:${ref.id}`);
    const result = applyFoundationType(ref, type);
    if (result.ok) out.updated++;
    else out.refused.push(result.error);
  }
  return out;
}

/** A strip foundation selects whole: a click on its wall or footing takes both, the foundation inspected. */
function stripFoundationBlock(renderId: number): { members: number[]; primary: number } | null {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const l = ref ? live(ref.modelId) : null;
  if (!ref || !l) return null;
  let id: number | null = null;
  try { id = stripFoundationOf(l.dataStore, ref.expressId, l.view); } catch { id = null; }
  if (id === null) return null;
  const parts = stripFoundationParts(l.dataStore, id, l.view);
  return { members: parts.map((p) => toGlobalIdFromModels(s.models, ref.modelId, p)), primary: toGlobalIdFromModels(s.models, ref.modelId, id) };
}

let installed = false;
/** Mount once: strip foundations select as blocks. */
export function installFoundationBlocks(): void {
  if (installed) return;
  installed = true;
  registerBlockResolver(stripFoundationBlock);
}
