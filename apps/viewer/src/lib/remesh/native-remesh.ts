/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Native remesh (N3, docs/format-lapin-nativ.md), behind `?perf.nativeRemesh=1`:
 * the edited elements the native mesher rebuilds exactly (`planNativeRemesh`)
 * are meshed from their parameters, without the STEP subgraph; the rest take
 * the IFC remesh as before. Both come back as the same `MeshData`, so
 * framing and the swap into the scene are shared.
 *
 * An element drawn through GPU instancing, or drawn otherwise than the native
 * path will draw it (whole vs. one mesh per material layer), stays on the IFC
 * path. Each native mesh takes the colour its element's mesh of the same
 * representation item is drawn in now (a joinery type's frame, glass, ...).
 */

import { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { MeshData, RtcFrame } from '@ifc-lite/geometry';
import type { RemeshClient, RemeshResult } from '@ifc-lite/geometry/remesh';
import { planNativeRemesh, type NativeRemeshPlan } from '@ifc-lite/create';
import type { FederatedModel } from '@/store/types';
import { readPerfFlag } from '@/lib/perf/flags';

export interface NativeSplit {
  plan: NativeRemeshPlan;
  colors: Float32Array;
  materialColors: Float32Array;
  /** What the IFC remesh still has to do. */
  stepTargets: Set<number>;
}

export function nativeRemeshEnabled(): boolean {
  const value = readPerfFlag('nativeRemesh');
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Meshes on screen by global express id. */
export function drawnMeshes(model: FederatedModel): Map<number, MeshData[]> {
  const drawn = new Map<number, MeshData[]>();
  for (const mesh of model.geometryResult?.meshes ?? []) {
    const list = drawn.get(mesh.expressId);
    if (list) list.push(mesh);
    else drawn.set(mesh.expressId, [mesh]);
  }
  return drawn;
}

/** A light neutral grey for an element not drawn yet. */
const UNDRAWN: [number, number, number, number] = [0.8, 0.8, 0.8, 1];

/** Each planned part, and each layer material, in the colour it is drawn in now. */
export function planColors(drawn: ReadonlyMap<number, MeshData[]>, plan: NativeRemeshPlan, toGlobal: (id: number) => number) {
  const colors = new Float32Array(plan.expressIds.length * 4);
  plan.expressIds.forEach((id, i) => {
    const meshes = drawn.get(toGlobal(id)) ?? [];
    // Drawn item ids are re-homed like express ids in a federated session.
    const item = plan.itemIds[i];
    const same = item ? meshes.find((m) => m.geometryItemId === toGlobal(item)) : undefined;
    colors.set((same ?? meshes[0])?.color ?? UNDRAWN, i * 4);
  });
  const materialColors = new Float32Array(plan.materialIds.length * 4);
  const byMaterial = new Map<number, MeshData>();
  for (const id of plan.expressIds) for (const m of drawn.get(toGlobal(id)) ?? []) if (m.materialId !== undefined) byMaterial.set(m.materialId, m);
  plan.materialIds.forEach((material, i) => materialColors.set(byMaterial.get(toGlobal(material))?.color ?? UNDRAWN, i * 4));
  return { colors, materialColors };
}

/** Split `targets` into the native part and the IFC part; null when nothing goes native. */
export function nativeSplit(
  model: FederatedModel,
  store: IfcDataStore,
  view: MutablePropertyView | null,
  targets: ReadonlySet<number>,
  toGlobal: (expressId: number) => number,
): NativeSplit | null {
  if (!nativeRemeshEnabled()) return null;
  const drawn = drawnMeshes(model);
  const instanced = model.geometryResult?.instancedGeometryHashes;
  const plan = planNativeRemesh(store, view ?? new MutablePropertyView(null, model.id), targets, (id, layered) => {
    const global = toGlobal(id);
    if (instanced?.has(global)) return 'drawn through GPU instancing';
    const meshes = drawn.get(global) ?? [];
    if (meshes.length === 0) return 'not drawn yet';
    // Drawn as the native path will draw it: whole, or one mesh per layer material.
    const perLayer = meshes.every((m) => m.materialId !== undefined);
    if (layered) return meshes.length >= 2 && perLayer ? null : 'drawn whole although it has material layers';
    return meshes.some((m) => m.materialId !== undefined) ? 'drawn with one mesh per material layer' : null;
  });
  if (plan.expressIds.length === 0) return null;
  const { colors, materialColors } = planColors(drawn, plan, toGlobal);
  const stepTargets = new Set([...targets].filter((id) => !plan.expressIds.includes(id)));
  return { plan, colors, materialColors, stepTargets };
}

/** The native meshes joined to the IFC remesh's (`step`, null when it had nothing to do). */
export async function withNative(worker: { remeshNative?: RemeshClient['remeshNative'] }, split: NativeSplit | null, frame: RtcFrame, step: RemeshResult | null): Promise<RemeshResult> {
  if (!split) return step!;
  if (!worker.remeshNative) throw new Error('native remesh: the remesh worker cannot mesh native elements');
  const native = await worker.remeshNative({
    buffer: split.plan.buffer, expressIds: Uint32Array.from(split.plan.expressIds),
    ifcTypes: split.plan.ifcTypes, colors: split.colors, itemIds: Uint32Array.from(split.plan.itemIds), frames: split.plan.frames, layers: split.plan.layers,
    materialIds: Uint32Array.from(split.plan.materialIds), materialColors: split.materialColors, frame,
  });
  return {
    meshes: [...(step?.meshes ?? []), ...native.meshes],
    csgFailures: step?.csgFailures ?? 0,
    ms: { prepass: step?.ms.prepass ?? 0, produce: (step?.ms.produce ?? 0) + native.ms.produce },
  };
}
