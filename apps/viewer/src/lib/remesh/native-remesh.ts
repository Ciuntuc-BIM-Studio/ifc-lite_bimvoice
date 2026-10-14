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
 * An element drawn today with more than one mesh (one per material layer) or
 * through GPU instancing stays on the IFC path: the native mesher builds one
 * body, in the colour the element is drawn in now.
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
  /** What the IFC remesh still has to do. */
  stepTargets: Set<number>;
}

export function nativeRemeshEnabled(): boolean {
  const value = readPerfFlag('nativeRemesh');
  return value === true || value === 1 || value === '1' || value === 'true';
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
  const drawn = new Map<number, MeshData[]>();
  for (const mesh of model.geometryResult?.meshes ?? []) {
    const list = drawn.get(mesh.expressId);
    if (list) list.push(mesh);
    else drawn.set(mesh.expressId, [mesh]);
  }
  const instanced = model.geometryResult?.instancedGeometryHashes;
  const plan = planNativeRemesh(store, view ?? new MutablePropertyView(null, model.id), targets, (id) => {
    const global = toGlobal(id);
    if (instanced?.has(global)) return 'drawn through GPU instancing';
    const meshes = drawn.get(global)?.length ?? 0;
    return meshes === 1 ? null : meshes === 0 ? 'not drawn yet' : 'drawn with one mesh per material layer';
  });
  if (plan.expressIds.length === 0) return null;
  const colors = new Float32Array(plan.expressIds.length * 4);
  plan.expressIds.forEach((id, i) => colors.set(drawn.get(toGlobal(id))![0].color, i * 4));
  const stepTargets = new Set([...targets].filter((id) => !plan.expressIds.includes(id)));
  return { plan, colors, stepTargets };
}

/** The native meshes joined to the IFC remesh's (`step`, null when it had nothing to do). */
export async function withNative(worker: { remeshNative?: RemeshClient['remeshNative'] }, split: NativeSplit | null, frame: RtcFrame, step: RemeshResult | null): Promise<RemeshResult> {
  if (!split) return step!;
  if (!worker.remeshNative) throw new Error('native remesh: the remesh worker cannot mesh native elements');
  const native = await worker.remeshNative({
    buffer: split.plan.buffer, expressIds: Uint32Array.from(split.plan.expressIds),
    ifcTypes: split.plan.ifcTypes, colors: split.colors, frame,
  });
  return {
    meshes: [...(step?.meshes ?? []), ...native.meshes],
    csgFailures: step?.csgFailures ?? 0,
    ms: { prepass: step?.ms.prepass ?? 0, produce: (step?.ms.produce ?? 0) + native.ms.produce },
  };
}
