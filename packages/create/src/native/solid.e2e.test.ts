/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Studio's free solids are native elements: written as the Studio builders
 * write them (an extrusion or a faceted shell, their history in
 * Pset_LapinSolid), they are lifted with that history — in the session and
 * from the IFC read back — measured from it, and meshed from it natively
 * into the body the IFC path meshes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PropertyValueType } from '@ifc-lite/data';
import type { NativeSolidShape } from './schema.js';

const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));

let runtime: typeof import('@ifc-lite/wasm');
let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let mutations: typeof import('@ifc-lite/mutations');
let StepExporter: typeof import('@ifc-lite/export').StepExporter;
let create: typeof import('../index.js');

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });

function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  const p = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [p(indices[t]), p(indices[t + 1]), p(indices[t + 2])];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(v);
}

const SHAPES: Record<string, { ifcClass: string; shape: NativeSolidShape }> = {
  block: { ifcClass: 'IfcBuildingElementProxy', shape: { operation: 'extrude', outer: [[0, 0], [2, 0], [2, 1], [0, 1]], holes: [[[0.5, 0.25], [0.5, 0.75], [1, 0.75], [1, 0.25]]], depth: 0.5, location: [10, 0, 0], axis: [0, 0, 1], refDirection: [1, 0, 0] } },
  lwall: { ifcClass: 'IfcWall', shape: { operation: 'extrude', outer: [[0, 0], [4, 0], [4, 3], [3.8, 3], [3.8, 0.2], [0, 0.2]], depth: 2.7, location: [0, 10, 0], axis: [0, 0, 1], refDirection: [1, 0, 0] } },
  sweep: { ifcClass: 'IfcBuildingElementProxy', shape: { operation: 'sweep', profile: [[-0.1, 0], [0.1, 0], [0.1, 0.3], [-0.1, 0.3]], path: [[0, -5, 0], [3, -5, 0], [3, -2, 0]] } },
  revolve: { ifcClass: 'IfcFurnishingElement', shape: { operation: 'revolve', profile: [[20.2, 0, 0], [20.5, 0, 0], [20.4, 0, 0.8], [20.25, 0, 1]], origin: [20, 0, 0], direction: [0, 0, 1], angle: 2 * Math.PI } },
};

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('Studio solids as native elements', () => {
  beforeAll(async () => {
    runtime = await import('@ifc-lite/wasm');
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    mutations = await import('@ifc-lite/mutations');
    ({ StepExporter } = await import('@ifc-lite/export'));
    create = await import('../index.js');
  }, 60_000);

  it('are lifted with their history, measured and meshed from it, in the session and from the IFC read back', async () => {
    const store = await parse(readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url)));
    const view = new mutations.MutablePropertyView(null, 'm');
    const editor = new mutations.StoreEditor(store, view);
    const storey = [...store.spatialHierarchy!.storeyElevations.keys()][0];
    const anchor = create.resolveSpatialAnchor(store, storey, view);
    const ids = new Map<string, number>();
    for (const [key, { ifcClass, shape }] of Object.entries(SHAPES)) {
      const native = { id: '', kind: 'solid' as const, storeyId: '', ifcClass, shape };
      const params = create.solidStoreParams(native);
      const id = params.kind === 'extrusion' ? create.addExtrusionToStore(editor, anchor, params.params).elementId : create.addFacetedElementToStore(editor, anchor, params.params).elementId;
      // What the Studio builders write beside the body.
      view.setProperty(id, create.NATIVE_SOLID_PSET, 'Spec', JSON.stringify(shape), PropertyValueType.Text);
      ids.set(key, id);
    }

    const check = (lifted: ReturnType<typeof create.liftNativeModel>, label: string) => {
      for (const [key, { ifcClass, shape }] of Object.entries(SHAPES)) {
        const e = lifted.model.elements.find((x) => lifted.expressIds.get(x.id) === ids.get(key));
        expect(e, `${label} ${key}: ${JSON.stringify(lifted.skipped.filter((s) => s.expressId === ids.get(key)))}`).toMatchObject({ kind: 'solid', ifcClass: expect.stringMatching(new RegExp(ifcClass, 'i')) });
        expect(e && e.kind === 'solid' ? e.shape : null, `${label} ${key} history`).toEqual(shape);
      }
      expect(lifted.skipped.filter((s) => [...ids.values()].includes(s.expressId))).toEqual([]);
    };
    const session = create.liftNativeModel(store, view, { id: '00000000-0000-4000-8000-000000000000', name: '' });
    check(session, 'session');

    // Quantities from the history: the block's net volume (2 x 1 less 0.5 x 0.5, by 0.5) and the proxy set.
    expect(create.solidMeasures(SHAPES.block.shape).volume).toBeCloseTo((2 - 0.25) * 0.5, 9);
    const q = create.nativeElementQuantities(store, view, ids.get('block')!);
    expect(q?.set).toBe('Qto_BuildingElementProxyQuantities');
    expect(q?.quantities.find((x) => x.name === 'NetVolume')?.value).toBeCloseTo(0.875, 9);

    // Meshed natively from the history: the volumes the history gives.
    for (const key of ['block', 'sweep', 'revolve'] as const) {
      const e = session.model.elements.find((x) => session.expressIds.get(x.id) === ids.get(key))!;
      const index = create.nativeIndex(session.model);
      const [mesh] = runtime.meshNativeSolids(create.encodeNativeSolids(create.nativeElementSolids(e, index))) as Array<{ positions: Float32Array; indices: Uint32Array }>;
      expect(meshVolume(mesh.positions, mesh.indices), `${key} native mesh volume`).toBeCloseTo(create.solidMeasures(SHAPES[key].shape).volume, 3);
    }

    // Exported and read back (its history now a property set of the file): the same solids.
    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array;
    const reparsed = await parse(bytes);
    const fresh = new mutations.MutablePropertyView(null, 'r');
    check(create.liftNativeModel(reparsed, fresh, { id: '00000000-0000-4000-8000-000000000000', name: '' }), 'read back');
  });
});
