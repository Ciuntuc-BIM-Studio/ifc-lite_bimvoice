/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Boolean operations between two crossing walls, exported, re-parsed and meshed by the real WASM engine. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { IfcAPI } from '@ifc-lite/wasm';

const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));
let RuntimeIfcAPI: typeof IfcAPI;
let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let MutablePropertyView: typeof import('@ifc-lite/mutations').MutablePropertyView;
let StoreEditor: typeof import('@ifc-lite/mutations').StoreEditor;
let StepExporter: typeof import('@ifc-lite/export').StepExporter;
let resolveSpatialAnchor: typeof import('./resolve-anchor.js').resolveSpatialAnchor;
let walls: typeof import('./wall.js');
let booleans: typeof import('./element-boolean.js');

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  { disableWorkerScan: true },
);

/** The element's mesh vertices, render space (y up). */
function vertices(bytes: Uint8Array, store: IfcDataStore, id: number): number[][] {
  const api = new RuntimeIfcAPI();
  try {
    const ref = store.entityIndex.byId.get(id)!;
    const pre = api.buildPrePassOnce(bytes);
    const c = api.processGeometryBatch(bytes, new Uint32Array([id, ref.byteOffset, ref.byteOffset + ref.byteLength]), pre.unitScale, 0, 0, 0, false,
      pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
    const out: number[][] = [];
    try {
      for (let i = 0; i < c.length; i++) {
        const m = c.takeMesh(i);
        if (!m) continue;
        try {
          for (let j = 0; j < m.positions.length; j += 3) out.push([m.origin[0] + m.positions[j], m.origin[1] + m.positions[j + 1], m.origin[2] + m.positions[j + 2]]);
        } finally { m.free(); }
      }
    } finally { c.free(); }
    return out;
  } finally {
    try { api.clearPrePassCache(); } finally { api.free(); }
  }
}


const bounds = (v: number[][]) => ({
  x: [Math.min(...v.map((p) => p[0])), Math.max(...v.map((p) => p[0]))],
  up: [Math.min(...v.map((p) => p[1])), Math.max(...v.map((p) => p[1]))],
  z: [Math.min(...v.map((p) => p[2])), Math.max(...v.map((p) => p[2]))],
});

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('boolean operations between elements, real WASM meshes', () => {
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveSpatialAnchor } = await import('./resolve-anchor.js'));
    walls = await import('./wall.js');
    booleans = await import('./element-boolean.js');
  }, 60_000);

  async function crossing() {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyId, view);
    // A: 4 m long along x, 0.2 thick, 3 high. B: across it at x = 2, 2 m long, 0.4 thick, 5 high.
    const a = walls.addWallToStore(editor, anchor, { Start: [0, 0, 0], End: [4, 0, 0], Thickness: 0.2, Height: 3 }).wallId;
    const b = walls.addWallToStore(editor, anchor, { Start: [2, -1, 0], End: [2, 1, 0], Thickness: 0.4, Height: 5 }).wallId;
    const mesh = async (id: number) => {
      const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
      return vertices(bytes, await parse(bytes), id);
    };
    return { store, view, editor, anchor, a, b, mesh };
  }

  it('subtracts live: the target keeps its body, the cut follows; taken back it is whole again', async () => {
    const { store, editor, anchor, a, b, mesh, view } = await crossing();
    const plain = await mesh(a);
    expect(plain.some((p) => p[0] > 1.7 && p[0] < 2.3)).toBe(false);
    expect(booleans.subtractElementsInStore(store, editor, anchor, a, [b])).toEqual([a, b]);
    // No second relation for the same pair.
    expect(booleans.subtractElementsInStore(store, editor, anchor, a, [b])).toEqual([]);
    expect(booleans.readSubtractions(store, view)).toHaveLength(1);
    const cut = await mesh(a);
    // The cut's faces at x = 1.8 and 2.2 (B's faces).
    expect(cut.some((p) => Math.abs(p[0] - 1.8) < 1e-3)).toBe(true);
    expect(cut.some((p) => Math.abs(p[0] - 2.2) < 1e-3)).toBe(true);
    expect(bounds(cut).x).toEqual(bounds(plain).x);
    expect(booleans.removeSubtractionsInStore(store, editor, [b]).sort()).toEqual([a, b].sort());
    expect((await mesh(a)).some((p) => p[0] > 1.7 && p[0] < 2.3)).toBe(false);
  });

  it('unites into the target: it reaches as high and as far as the tool', async () => {
    const { store, editor, a, b, mesh } = await crossing();
    expect(booleans.bakeBooleanInStore(store, editor, a, [b], 'UNION')).toEqual({ ok: true, remesh: [a] });
    const box = bounds(await mesh(a));
    expect(box.up[1]).toBeCloseTo(5, 3);
    expect(box.x[0]).toBeCloseTo(0, 3);
    expect(box.x[1]).toBeCloseTo(4, 3);
    expect(box.z[1] - box.z[0]).toBeCloseTo(2, 3);
  });

  it('intersects: only what both hold stays', async () => {
    const { store, editor, a, b, mesh } = await crossing();
    expect(booleans.bakeBooleanInStore(store, editor, a, [b], 'INTERSECTION').ok).toBe(true);
    const box = bounds(await mesh(a));
    expect(box.x[0]).toBeCloseTo(1.8, 3);
    expect(box.x[1]).toBeCloseTo(2.2, 3);
    expect(box.up[1]).toBeCloseTo(3, 3);
    expect(box.z[1] - box.z[0]).toBeCloseTo(0.2, 3);
  });
});
