/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Flipping elements in place: an asymmetric solid mirrors about its own
 * centre (its box stays put, its shape turns over) through a mapped item the
 * real WASM engine meshes; flipping back restores the original body; a wall
 * swaps faces (profile and layer-set usage) and refuses a flip along itself.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcAPI } from '@ifc-lite/wasm';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addFacetedElementToStore } from './faceted.js';
import { addWallToStore } from './wall.js';
import { addMaterialLayerSetToStore, addMaterialLayerSetUsageToStore, addMaterialToStore, assignMaterialInStore } from './material.js';
import { flipElementInStore } from './element-flip.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);
const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  { disableWorkerScan: true },
);

async function session() {
  const store = await parse(readFileSync(SAMPLE));
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  return { store, view, editor, anchor: resolveSpatialAnchor(store, 42, view) };
}

type V3 = [number, number, number];
/** An L-shaped prism (asymmetric about both its mid-planes): 2 × 2 with a 1 × 1 notch, 1 high. */
function lPrism(): V3[][] {
  const plan: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const bottom = plan.map(([x, y]) => [x, y, 0] as V3).reverse();
  const top = plan.map(([x, y]) => [x, y, 1] as V3);
  const sides = plan.map(([x, y], i) => {
    const [nx, ny] = plan[(i + 1) % plan.length];
    return [[x, y, 0], [nx, ny, 0], [nx, ny, 1], [x, y, 1]] as V3[];
  });
  return [bottom, top, ...sides];
}

const refOf = (v: unknown) => (typeof v === 'string' && v.startsWith('#') ? Number(v.slice(1)) : null);
const bodyRep = (view: MutablePropertyView, editor: StoreEditor, id: number) => {
  const shapeRef = view.getPositionalMutationsForEntity(id)?.get(6) ?? editor.getNewEntity(id)?.attributes[6];
  const shape = editor.getNewEntity(refOf(shapeRef)!);
  return refOf((shape?.attributes[2] as unknown[])[0]);
};

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('flipped elements, real WASM mesh', () => {
  let RuntimeIfcAPI: typeof IfcAPI;
  let StepExporter: typeof import('@ifc-lite/export').StepExporter;
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ StepExporter } = await import('@ifc-lite/export'));
  }, 60_000);

  /** Mesh bounds and vertex centroid (IFC Z-up) of one element of an exported model. */
  function meshOf(bytes: Uint8Array, store: IfcDataStore, id: number) {
    const api = new RuntimeIfcAPI();
    try {
      const ref = store.entityIndex.byId.get(id)!;
      const pre = api.buildPrePassOnce(bytes);
      const c = api.processGeometryBatch(bytes, new Uint32Array([id, ref.byteOffset, ref.byteOffset + ref.byteLength]), pre.unitScale, 0, 0, 0, false,
        pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], sum = [0, 0, 0];
      let n = 0, area = 0;
      try {
        for (let i = 0; i < c.length; i++) {
          const m = c.takeMesh(i);
          if (!m) continue;
          try {
            const p = m.positions, o = m.origin;
            const v = (j: number) => [o[0] + p[j], -(o[2] + p[j + 2]), o[1] + p[j + 1]];
            for (let j = 0; j < p.length; j += 3) {
              const q = v(j);
              for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
            }
            // Area-weighted triangle centroids: independent of how the mesher splits faces.
            const idx = m.indices;
            for (let t = 0; t < idx.length; t += 3) {
              const a = v(idx[t] * 3), b = v(idx[t + 1] * 3), d = v(idx[t + 2] * 3);
              const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
              const s = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
              for (let k = 0; k < 3; k++) sum[k] += s * (a[k] + b[k] + d[k]) / 3;
              area += s;
              n++;
            }
          } finally { m.free(); }
        }
      } finally { c.free(); }
      return { min, max, centroid: sum.map((v) => v / area), triangles: n };
    } finally {
      try { api.clearPrePassCache(); } finally { api.free(); }
    }
  }

  it('mirrors an L-shaped solid about its own centre and back', async () => {
    const { store, view, editor, anchor } = await session();
    const made = addFacetedElementToStore(editor, anchor, { IfcClass: 'IfcBuildingElementProxy', Faces: lPrism(), Location: [10, 0, 0] });
    const original = bodyRep(view, editor, made.elementId)!;
    const exportMesh = async () => {
      const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
      return meshOf(bytes, await parse(bytes), made.elementId);
    };
    const start = await exportMesh();
    expect(start.triangles).toBeGreaterThan(0);

    expect(flipElementInStore(store, editor, made.elementId, 'x')).toEqual({ ok: true, remesh: [made.elementId] });
    const flippedX = await exportMesh();
    // The box stays where it was; the notch moves to the other side.
    for (let k = 0; k < 3; k++) {
      expect(flippedX.min[k]).toBeCloseTo(start.min[k], 6);
      expect(flippedX.max[k]).toBeCloseTo(start.max[k], 6);
    }
    expect(flippedX.centroid[0]).toBeCloseTo(2 * 11 - start.centroid[0], 6);
    expect(flippedX.centroid[1]).toBeCloseTo(start.centroid[1], 6);

    expect(flipElementInStore(store, editor, made.elementId, 'y').ok).toBe(true);
    const flippedXY = await exportMesh();
    expect(flippedXY.centroid[0]).toBeCloseTo(2 * 11 - start.centroid[0], 6);
    expect(flippedXY.centroid[1]).toBeCloseTo(2 * 1 - start.centroid[1], 6);

    // Back the other way twice: the original body, the wrapper gone.
    const size = view.getNewEntities().length;
    flipElementInStore(store, editor, made.elementId, 'x');
    flipElementInStore(store, editor, made.elementId, 'y');
    expect(bodyRep(view, editor, made.elementId)).toBe(original);
    expect(view.getNewEntities().some((e) => e.type === 'IfcRepresentationMap')).toBe(false);
    expect(view.getNewEntities().length).toBeLessThan(size);
    const back = await exportMesh();
    expect(back.centroid[0]).toBeCloseTo(start.centroid[0], 6);
    expect(back.centroid[1]).toBeCloseTo(start.centroid[1], 6);
  });

  it('swaps a wall\'s faces: offset body and layer-set usage, refusing a flip along it', async () => {
    const { store, view, editor, anchor } = await session();
    const wall = addWallToStore(editor, anchor, { Start: [0, 10, 0], End: [5, 10, 0], Thickness: 0.3, Height: 3, Alignment: 'left' });
    const brick = addMaterialToStore(editor, anchor, { Name: 'Brick' }).materialId;
    const insulation = addMaterialToStore(editor, anchor, { Name: 'Insulation' }).materialId;
    const set = addMaterialLayerSetToStore(editor, anchor, { MaterialLayers: [{ Material: brick, LayerThickness: 0.2 }, { Material: insulation, LayerThickness: 0.1 }] });
    const usage = addMaterialLayerSetUsageToStore(editor, anchor, { ForLayerSet: set.layerSetId, OffsetFromReferenceLine: -0.3 }).usageId;
    assignMaterialInStore(editor, anchor, usage, [wall.wallId], []);

    const exportMesh = async () => {
      const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
      return meshOf(bytes, await parse(bytes), wall.wallId);
    };
    const start = await exportMesh();
    expect(flipElementInStore(store, editor, wall.wallId, 'x').ok).toBe(false);
    expect(flipElementInStore(store, editor, wall.wallId, 'y')).toEqual({ ok: true, remesh: [wall.wallId] });
    const flipped = await exportMesh();
    // The body went to the other side of the axis (y = 10): mirrored across it.
    expect(flipped.min[1]).toBeCloseTo(20 - start.max[1], 6);
    expect(flipped.max[1]).toBeCloseTo(20 - start.min[1], 6);
    expect(flipped.min[0]).toBeCloseTo(start.min[0], 6);
    const u = view.getPositionalMutationsForEntity(usage);
    expect(u?.get(2)).toBe('.NEGATIVE.');
    // The offset (native units) changes sign.
    expect(u?.get(3)).toEqual({ real: -(view.getNewEntity(usage)!.attributes[3] as { real: number }).real });
    // Still a plain extrusion: no mapped wrapper.
    expect(view.getNewEntities().some((e) => e.type === 'IfcRepresentationMap')).toBe(false);
  });
});
