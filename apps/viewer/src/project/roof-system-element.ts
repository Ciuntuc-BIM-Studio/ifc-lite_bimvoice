/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Roof systems in the loaded models (`@ifc-lite/create`'s roof-system-store):
 * created from a closed contour on a floor plan, read back from any element
 * of the block, changed (rules, covering, structure) and regenerated in
 * place — one undo step each; parts no longer generated leave the 3D view,
 * new and rewritten ones are re-meshed. The contour stays linked
 * (`params.roofSystem`): editing it regenerates the block on the new outline.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import {
  addRoofSystemToStore, defaultRoofStructure, orientRoof, readRoofSystem, regenerateRoofSystemInStore, removeRoofSystemFromStore, resolveSpatialAnchor,
  roofSystemOf, type RoofEdgeRule, type RoofLayer, type RoofSystemSpec,
} from '@ifc-lite/create';
import { storeyOfElement } from '@/project/effective-storey';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { stashAndPruneEntityMesh } from '@/store/slices/mutation-mesh-stash';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { drawingToWorld } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { setDraftParams } from '@/drafting/draft-store';
import { useProjectStore } from './project-store';
import { findElementByGlobalId, prepare, type ContourElementResult } from './contour-element';
import type { ProjectView } from './types';
import { ensureEditMode } from '@/project/edit-mode';

type Vec2 = [number, number];

export interface RoofDefaults {
  /** 'hip': every edge an eave; 'gable': a rectangle's short edges gables; 'mono': edge 0 the eave. */
  shape: 'hip' | 'gable' | 'mono';
  pitch: number;
  overhang: number;
  thickness: number;
  /** Wall plate above the plan's level. */
  eaveHeight: number;
}

/** A new roof's covering build-up, outermost first: the tiles over their underlay. */
export function defaultCoveringLayers(thickness: number): RoofLayer[] {
  const underlay = Math.min(0.002, thickness / 10);
  return [{ name: 'Roof tiles', thickness: Math.max(thickness - underlay, 0.001) }, { name: 'Underlay membrane', thickness: underlay }];
}

/** Default rules for an outline: the shape's eaves and gables, all at one pitch and overhang. */
export function defaultRules(outline: readonly Vec2[], d: RoofDefaults): RoofEdgeRule[] {
  const n = outline.length;
  const len = outline.map((p, i) => Math.hypot(outline[(i + 1) % n][0] - p[0], outline[(i + 1) % n][1] - p[1]));
  const eave = { kind: 'eave' as const, pitch: d.pitch, overhang: d.overhang };
  const gable = { kind: 'gable' as const, pitch: 0, overhang: Math.min(d.overhang, 0.4) };
  if (d.shape === 'mono') return outline.map((_, i) => (i === 0 ? eave : gable));
  if (d.shape === 'gable' && n === 4) {
    const short = len[0] + len[2] <= len[1] + len[3] ? [0, 2] : [1, 3];
    return outline.map((_, i) => (short.includes(i) ? gable : eave));
  }
  return outline.map(() => eave);
}

const storeyOf = storeyOfElement;

function afterCommit(modelId: string, storeyId: number, parts: readonly number[], removed: readonly number[], created: boolean, roofId?: number): void {
  const get = useViewerStore.getState;
  const set = useViewerStore.setState;
  for (const id of removed) stashAndPruneEntityMesh(get, set, modelId, id);
  const hierarchy = get().models.get(modelId)?.ifcDataStore?.spatialHierarchy;
  if (hierarchy && roofId !== undefined && !hierarchy.elementToStorey.has(roofId)) registerAuthoredElement(hierarchy, storeyId, roofId, 'IFCROOF', 'Roof');
  if (hierarchy) for (const id of parts) if (!hierarchy.elementToStorey.has(id)) hierarchy.elementToStorey.set(id, storeyId);
  if (parts.length) void requestRemesh(get, modelId, parts, created ? 'created' : 'shape');
}

/** A roof type's build-up for a new roof system: covering, structure, timber colour, and the type it came from. */
export type RoofPreset = Pick<RoofSystemSpec, 'covering' | 'structure' | 'timberColor' | 'typeId'>;

/** Build a roof system over a drafted outline (drawing coordinates on a floor plan). */
export function createRoofSystem(view: ProjectView, plane: SectionPlaneConfig, outline: Pt[], defaults: RoofDefaults, name = 'Roof', preset?: RoofPreset): ContourElementResult {
  if (view.kind !== 'plan') return { ok: false, error: 'Roofs are drawn on a floor plan.' };
  const ready = prepare(view, plane, [outline]);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const local = outline.map((p) => ready.toLocal(drawingToWorld(plane, p)));
    // Stored counter-clockwise, so edge i of the spec is edge i of its geometry.
    const pts = orientRoof(local.map((p) => [p.x, p.y] as Vec2), local.map(() => ({ kind: 'eave' as const, pitch: defaults.pitch, overhang: defaults.overhang }))).outline;
    const spec: RoofSystemSpec = {
      name, outline: pts, rules: defaultRules(pts, defaults), eaveHeight: local[0].z + defaults.eaveHeight,
      covering: { thickness: defaults.thickness, color: '#8b4a3a', layers: defaultCoveringLayers(defaults.thickness) }, structure: defaultRoofStructure(), timberColor: '#c8a070',
      ...preset,
    };
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      return addRoofSystemToStore(editor, resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView()), spec);
    });
    afterCommit(ready.modelId, ready.storeyId, made.parts, [], true, made.roofId);
    return { ok: true, modelId: ready.modelId, elementId: made.roofId, globalId: made.globalId, ifcClass: 'IfcRoof' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface RoofSystemRef {
  modelId: string;
  roofId: number;
  spec: RoofSystemSpec;
}

/** The roof system of an element (the roof or any of its parts), by renderer id. */
export function roofSystemOfRenderId(renderId: number): RoofSystemRef | null {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const dataStore = ref ? s.models.get(ref.modelId)?.ifcDataStore : null;
  if (!ref || !dataStore) return null;
  const view = s.mutationViews.get(ref.modelId) ?? null;
  const roofId = roofSystemOf(dataStore, ref.expressId, view);
  const spec = roofId === null ? null : readRoofSystem(dataStore, roofId, view);
  return roofId !== null && spec ? { modelId: ref.modelId, roofId, spec } : null;
}

export function roofSystemByGlobalId(modelId: string, globalId: string): RoofSystemRef | null {
  const roofId = findElementByGlobalId(modelId, globalId);
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  if (roofId === null || !dataStore) return null;
  const spec = readRoofSystem(dataStore, roofId, s.mutationViews.get(modelId) ?? null);
  return spec ? { modelId, roofId, spec } : null;
}

/** Regenerate a roof system from a changed spec. */
export function applyRoofSystem(ref: Pick<RoofSystemRef, 'modelId' | 'roofId'>, spec: RoofSystemSpec): { ok: true } | { ok: false; error: string } {
  ensureEditMode();
  const storeyId = storeyOf(ref.modelId, ref.roofId);
  if (storeyId === null) return { ok: false, error: 'The roof is not on a storey.' };
  try {
    const result = recordModellingCommit(useViewerStore, ref.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, storeyId);
      return regenerateRoofSystemInStore(ds, editor, resolveSpatialAnchor(ds, storeyId, editor.getMutationView()), ref.roofId, spec);
    });
    afterCommit(ref.modelId, storeyId, result.parts, result.removed, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The contour was edited: the same rules (as far as the edges go) on the new outline. */
export function updateRoofSystemOutline(view: ProjectView, plane: SectionPlaneConfig, outline: Pt[], modelId: string, globalId: string): ContourElementResult {
  const ref = roofSystemByGlobalId(modelId, globalId);
  if (!ref) return { ok: false, error: 'The linked roof is no longer in the model.' };
  const ready = prepare(view, plane, [outline]);
  if (!ready.ok) return { ok: false, error: ready.error };
  const pts: Vec2[] = outline.map((p) => {
    const l = ready.toLocal(drawingToWorld(plane, p));
    return [l.x, l.y];
  });
  const oriented = orientRoof(pts, pts.map((_, i) => ref.spec.rules[i] ?? ref.spec.rules[ref.spec.rules.length - 1]));
  const result = applyRoofSystem(ref, { ...ref.spec, outline: oriented.outline, rules: oriented.rules });
  return result.ok ? { ok: true, modelId, elementId: ref.roofId, globalId, ifcClass: 'IfcRoof' } : result;
}

/**
 * A roof that owns its outline, reshaped on the plan (its grips): the new
 * outline in drawing coordinates and a rule per edge (edge i from point i).
 */
export function reshapeRoofSystem(ref: Pick<RoofSystemRef, 'modelId' | 'roofId' | 'spec'>, view: ProjectView, plane: SectionPlaneConfig, outline: Pt[], rules: RoofEdgeRule[]): { ok: true } | { ok: false; error: string } {
  if (outline.length < 3) return { ok: false, error: 'A roof outline needs at least three corners.' };
  const ready = prepare(view, plane, [outline]);
  if (!ready.ok) return { ok: false, error: ready.error };
  const pts: Vec2[] = outline.map((p) => {
    const l = ready.toLocal(drawingToWorld(plane, p));
    return [l.x, l.y];
  });
  const oriented = orientRoof(pts, rules);
  return applyRoofSystem(ref, { ...ref.spec, outline: oriented.outline, rules: oriented.rules });
}

/**
 * Delete a roof system whole — the roof, its planes and members, their
 * materials — in one undo step. A contour it was drawn from stays on the
 * plan, unlinked.
 */
export function deleteRoofSystem(ref: Pick<RoofSystemRef, 'modelId' | 'roofId'>): { ok: true } | { ok: false; error: string } {
  ensureEditMode();
  const get = useViewerStore.getState;
  const globalId = roofGuid(ref);
  try {
    const removed = recordModellingCommit(useViewerStore, ref.modelId, (editor, ds) => removeRoofSystemFromStore(ds, editor, ref.roofId));
    for (const id of removed) stashAndPruneEntityMesh(get, useViewerStore.setState, ref.modelId, id);
    const hierarchy = get().models.get(ref.modelId)?.ifcDataStore?.spatialHierarchy;
    if (hierarchy) for (const id of removed) hierarchy.elementToStorey.delete(id);
    get().setSelectedEntityId(null);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const drafts = useProjectStore.getState().drafts.filter((d) => d.params.ifcModelId === ref.modelId && d.params.ifcGlobalId === globalId);
  if (globalId && drafts.length) setDraftParams(new Set(drafts.map((d) => d.id)), { ifcGlobalId: null, ifcModelId: null, ifcClass: null, roofSystem: null });
  return { ok: true };
}

function roofGuid(ref: Pick<RoofSystemRef, 'modelId' | 'roofId'>): string | null {
  const s = useViewerStore.getState();
  const view = s.mutationViews.get(ref.modelId);
  const fresh = view?.getNewEntity(ref.roofId)?.attributes[0];
  if (typeof fresh === 'string') return fresh;
  return s.models.get(ref.modelId)?.ifcDataStore?.entities.getGlobalId(ref.roofId) || null;
}
