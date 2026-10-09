/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Road corridors and terrains in the loaded models (`@ifc-lite/create`'s
 * corridor-store): a corridor is made from a polyline drawn on a floor
 * plan — its vertices the PIs, rounded with a default radius, the profile
 * following the model's terrain when it has one — read back from any part
 * of the block, changed and regenerated in place, or deleted; one undo step
 * each. A terrain is an IfcGeographicElement built from survey points, or
 * copied from the mesh of a selected element (a LandXML surface, say).
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import {
  addCorridorToStore, addTerrainToStore, alignmentFromPolyline, buildAlignment, corridorOf, corridorParts, corridorsInStore, defaultAssembly, defaultDesign, delaunay, elementByGlobalId,
  profileFromGround, readCorridor, readTerrainTin, regenerateCorridorInStore, removeCorridorFromStore, resolveSpatialAnchor, Terrain, terrainsInStore, tinFromMesh,
  type CorridorSpec, type Tin,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { stashAndPruneEntityMesh } from '@/store/slices/mutation-mesh-stash';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { drawingToWorld } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { setDraftParams } from '@/drafting/draft-store';
import { useProjectStore } from '@/project/project-store';
import { findElementByGlobalId, prepareTarget } from '@/project/contour-element';
import type { ProjectView } from '@/project/types';
import { ensureEditMode } from '@/project/edit-mode';

type V3 = [number, number, number];

export type CivilResult = { ok: true; modelId: string; elementId: number; globalId: string } | { ok: false; error: string };

export interface CorridorRef {
  modelId: string;
  corridorId: number;
  spec: CorridorSpec;
}

function live(modelId: string) {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  return dataStore ? { dataStore, view: s.mutationViews.get(modelId) ?? null } : null;
}

function storeyOf(modelId: string, id: number): number | null {
  return useViewerStore.getState().models.get(modelId)?.ifcDataStore?.spatialHierarchy?.elementToStorey.get(id) ?? null;
}

/** The terrains of a model (name and GlobalId), for the configurator's choice. */
export function listTerrains(modelId: string): { id: number; name: string; globalId: string }[] {
  const m = live(modelId);
  return m ? terrainsInStore(m.dataStore, m.view) : [];
}

/** The TIN of the terrain a corridor refers to, in the storey's frame; null when none. */
export function terrainTin(modelId: string, storeyId: number, globalId: string | null | undefined): Tin | null {
  const m = live(modelId);
  if (!m || !globalId) return null;
  const id = elementByGlobalId(m.dataStore, m.view, globalId);
  if (id === null) return null;
  try {
    return readTerrainTin(m.dataStore, resolveSpatialAnchor(m.dataStore, storeyId, m.view), id, m.view);
  } catch {
    return null;
  }
}

function afterCommit(modelId: string, storeyId: number, parts: readonly number[], removed: readonly number[], created: boolean, whole?: { id: number; type: string; name: string }): void {
  const get = useViewerStore.getState;
  for (const id of removed) stashAndPruneEntityMesh(get, useViewerStore.setState, modelId, id);
  const hierarchy = get().models.get(modelId)?.ifcDataStore?.spatialHierarchy;
  if (hierarchy && whole && !hierarchy.elementToStorey.has(whole.id)) registerAuthoredElement(hierarchy, storeyId, whole.id, whole.type, whole.name);
  if (hierarchy) for (const id of parts) if (!hierarchy.elementToStorey.has(id)) hierarchy.elementToStorey.set(id, storeyId);
  if (parts.length) void requestRemesh(get, modelId, parts, created ? 'created' : 'shape');
}

export interface CorridorDefaults {
  name: string;
  /** PI radius, metres. */
  radius: number;
}

/** Build a corridor along a polyline drawn on a floor plan (drawing coordinates). */
export function createCorridorFromPolyline(view: ProjectView, plane: SectionPlaneConfig, pts: Pt[], defaults: CorridorDefaults, sourceId?: string): CivilResult {
  if (view.kind !== 'plan') return { ok: false, error: 'Roads are drawn on a floor plan.' };
  if (pts.length < 2) return { ok: false, error: 'A road needs a polyline of at least two points.' };
  const ready = prepareTarget(view, Math.min(...pts.map((p) => drawingToWorld(plane, p).y)));
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const local = pts.map((p) => ready.toLocal(drawingToWorld(plane, p)));
    const alignment = alignmentFromPolyline(local.map((p) => [p.x, p.y]), defaults.radius);
    const terrains = listTerrains(ready.modelId);
    const terrainGlobalId = terrains[0]?.globalId ?? null;
    const tin = terrainTin(ready.modelId, ready.storeyId, terrainGlobalId);
    const built = buildAlignment(alignment);
    const z0 = local[0].z;
    let profile = { pvis: [{ station: built.startStation, elevation: z0 }, { station: built.endStation, elevation: z0 }] };
    if (tin) {
      const terrain = new Terrain(tin);
      const ground = profileFromGround(built.startStation, built.endStation, (s) => { const p = built.pointAt(s); return terrain.elevationAt(p.x, p.y); });
      if (ground.pvis.length >= 2 && ground.pvis.some((p) => p.elevation !== 0)) profile = ground;
    }
    const spec: CorridorSpec = { name: defaults.name, alignment, profile, assembly: defaultAssembly(), design: defaultDesign(), interval: 10, terrainGlobalId };
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      return addCorridorToStore(ds, editor, resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView()), spec, tin);
    });
    afterCommit(ready.modelId, ready.storeyId, [...made.parts, ...(made.alignmentId === null ? [] : [made.alignmentId])], [], true, { id: made.corridorId, type: 'IFCELEMENTASSEMBLY', name: defaults.name });
    if (sourceId) setDraftParams(new Set([sourceId]), { ifcGlobalId: made.globalId, ifcModelId: ready.modelId, ifcClass: 'IfcElementAssembly', corridor: 1 });
    return { ok: true, modelId: ready.modelId, elementId: made.corridorId, globalId: made.globalId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The corridor an element belongs to (the assembly or any part), by renderer id. */
export function corridorOfRenderId(renderId: number): CorridorRef | null {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const m = ref ? live(ref.modelId) : null;
  if (!ref || !m) return null;
  const corridorId = corridorOf(m.dataStore, ref.expressId, m.view);
  const spec = corridorId === null ? null : readCorridor(m.dataStore, corridorId, m.view);
  return corridorId !== null && spec ? { modelId: ref.modelId, corridorId, spec } : null;
}

export function corridorByGlobalId(modelId: string, globalId: string): CorridorRef | null {
  const corridorId = findElementByGlobalId(modelId, globalId);
  const m = live(modelId);
  if (corridorId === null || !m) return null;
  const spec = readCorridor(m.dataStore, corridorId, m.view);
  return spec ? { modelId, corridorId, spec } : null;
}

/** The current spec of a corridor (re-read from the model). */
export function readCorridorSpec(modelId: string, corridorId: number): CorridorSpec | null {
  const m = live(modelId);
  return m ? readCorridor(m.dataStore, corridorId, m.view) : null;
}

/** Regenerate a corridor from a changed spec, one undo step. */
export function applyCorridor(ref: Pick<CorridorRef, 'modelId' | 'corridorId'>, spec: CorridorSpec): { ok: true; volumes: { cut: number; fill: number } } | { ok: false; error: string } {
  ensureEditMode();
  const storeyId = storeyOf(ref.modelId, ref.corridorId);
  if (storeyId === null) return { ok: false, error: 'The corridor is not on a storey.' };
  try {
    const tin = terrainTin(ref.modelId, storeyId, spec.terrainGlobalId);
    const result = recordModellingCommit(useViewerStore, ref.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, storeyId);
      return regenerateCorridorInStore(ds, editor, resolveSpatialAnchor(ds, storeyId, editor.getMutationView()), ref.corridorId, spec, tin);
    });
    afterCommit(ref.modelId, storeyId, [...result.parts, ...(result.alignmentId === null ? [] : [result.alignmentId])], result.removed, true);
    return { ok: true, volumes: result.model.volumes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The polyline was edited: the same radii (as far as the PIs go) on the new vertices. */
export function updateCorridorPolyline(view: ProjectView, plane: SectionPlaneConfig, pts: Pt[], modelId: string, globalId: string): CivilResult {
  const ref = corridorByGlobalId(modelId, globalId);
  if (!ref) return { ok: false, error: 'The linked corridor is no longer in the model.' };
  const ready = prepareTarget(view, Math.min(...pts.map((p) => drawingToWorld(plane, p).y)));
  if (!ready.ok) return { ok: false, error: ready.error };
  const local = pts.map((p) => ready.toLocal(drawingToWorld(plane, p)));
  const fresh = alignmentFromPolyline(local.map((p) => [p.x, p.y]), 50, ref.spec.alignment.startStation ?? 0);
  const pis = fresh.pis.map((pi, i) => {
    const old = ref.spec.alignment.pis[i];
    return old && i > 0 && i < fresh.pis.length - 1 && old.radius ? { ...pi, radius: Math.min(old.radius, pi.radius ?? old.radius), spiralIn: old.spiralIn, spiralOut: old.spiralOut } : pi;
  });
  const result = applyCorridor(ref, { ...ref.spec, alignment: { ...ref.spec.alignment, pis } });
  return result.ok ? { ok: true, modelId, elementId: ref.corridorId, globalId } : result;
}

/** Delete a corridor whole (courses, slopes, alignment), one undo step; a polyline it came from stays, unlinked. */
export function deleteCorridor(ref: Pick<CorridorRef, 'modelId' | 'corridorId'>): { ok: true } | { ok: false; error: string } {
  ensureEditMode();
  const get = useViewerStore.getState;
  const m = live(ref.modelId);
  const globalId = m?.view?.getNewEntity(ref.corridorId)?.attributes[0] ?? m?.dataStore.entities.getGlobalId(ref.corridorId) ?? null;
  try {
    const removed = recordModellingCommit(useViewerStore, ref.modelId, (editor, ds) => removeCorridorFromStore(ds, editor, ref.corridorId));
    for (const id of removed) stashAndPruneEntityMesh(get, useViewerStore.setState, ref.modelId, id);
    const hierarchy = get().models.get(ref.modelId)?.ifcDataStore?.spatialHierarchy;
    if (hierarchy) for (const id of removed) hierarchy.elementToStorey.delete(id);
    get().setSelectedEntityId(null);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const drafts = useProjectStore.getState().drafts.filter((d) => d.params.ifcModelId === ref.modelId && d.params.ifcGlobalId === globalId);
  if (globalId && drafts.length) setDraftParams(new Set(drafts.map((d) => d.id)), { ifcGlobalId: null, ifcModelId: null, ifcClass: null, corridor: null });
  return { ok: true };
}

/** The parts of a corridor (for isolation / selection). */
export function corridorPartIds(ref: Pick<CorridorRef, 'modelId' | 'corridorId'>): number[] {
  const m = live(ref.modelId);
  return m ? corridorParts(m.dataStore, ref.corridorId, m.view) : [];
}

/** Write a terrain (storey-local metres) into the model behind a view. */
export function createTerrain(view: ProjectView, tin: Tin, name: string): CivilResult {
  const ready = prepareTarget(view, 0);
  if (!ready.ok) return { ok: false, error: ready.error };
  if (tin.triangles.length === 0) return { ok: false, error: 'The terrain needs at least three points that are not in a line.' };
  try {
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      return addTerrainToStore(editor, resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView()), { Name: name, tin });
    });
    afterCommit(ready.modelId, ready.storeyId, [made.elementId], [], true, { id: made.elementId, type: 'IFCGEOGRAPHICELEMENT', name });
    return { ok: true, modelId: ready.modelId, elementId: made.elementId, globalId: made.globalId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A terrain triangulated from survey points given in the model's (storey-local) coordinates, metres. */
export function createTerrainFromPoints(view: ProjectView, points: V3[], name: string): CivilResult {
  if (points.length < 3) return { ok: false, error: 'At least three survey points are needed.' };
  return createTerrain(view, delaunay(points), name);
}

/** A terrain copied from the meshes of the selected element (any loaded model), into the model behind the view. */
export function createTerrainFromSelection(view: ProjectView, name: string): CivilResult {
  const s = useViewerStore.getState();
  const picked = [s.selectedEntityId, ...(s.selectedEntityIds ?? [])].find((id): id is number => typeof id === 'number');
  const ref = picked === undefined ? null : s.resolveGlobalIdFromModels(picked);
  if (!ref) return { ok: false, error: 'Select the element to use as terrain first.' };
  const meshes = (s.models.get(ref.modelId)?.geometryResult?.meshes ?? []).filter((m) => m.expressId === ref.expressId);
  if (meshes.length === 0) return { ok: false, error: 'The selected element has no mesh to read.' };
  const ready = prepareTarget(view, 0);
  if (!ready.ok) return { ok: false, error: ready.error };
  const positions: number[] = [], indices: number[] = [];
  for (const m of meshes) {
    const base = positions.length / 3;
    for (let i = 0; i < m.positions.length; i++) positions.push(m.positions[i]);
    for (let i = 0; i < m.indices.length; i++) indices.push(m.indices[i] + base);
  }
  const tin = tinFromMesh(positions, indices, (p) => { const l = ready.toLocal({ x: p[0], y: p[1], z: p[2] }); return [l.x, l.y, l.z]; });
  return createTerrain(view, tin, name);
}

/** Every corridor of the models shown on a plan (by its storeys), with its spec. */
export function corridorsOnView(view: ProjectView): (CorridorRef & { storeyId: number })[] {
  if (view.kind !== 'plan') return [];
  const s = useViewerStore.getState();
  const wanted = new Set(view.level.storeyGlobalIds);
  const out: (CorridorRef & { storeyId: number })[] = [];
  for (const [modelId, model] of s.models) {
    const dataStore = model.ifcDataStore;
    const hierarchy = dataStore?.spatialHierarchy;
    if (!dataStore || !hierarchy) continue;
    const mv = s.mutationViews.get(modelId) ?? null;
    for (const corridorId of corridorsOf(modelId)) {
      const storeyId = hierarchy.elementToStorey.get(corridorId);
      if (storeyId === undefined || (wanted.size && !wanted.has(dataStore.entities.getGlobalId(storeyId) ?? ''))) continue;
      const spec = readCorridor(dataStore, corridorId, mv);
      if (spec) out.push({ modelId, corridorId, spec, storeyId });
    }
  }
  return out;
}

/** Every corridor of every loaded model, with its spec. */
export function allCorridors(): CorridorRef[] {
  const out: CorridorRef[] = [];
  for (const [modelId] of useViewerStore.getState().models) {
    const m = live(modelId);
    if (!m) continue;
    for (const corridorId of corridorsInStore(m.dataStore, m.view)) {
      const spec = readCorridor(m.dataStore, corridorId, m.view);
      if (spec) out.push({ modelId, corridorId, spec });
    }
  }
  return out;
}

function corridorsOf(modelId: string): number[] {
  const m = live(modelId);
  return m ? corridorsInStore(m.dataStore, m.view) : [];
}
