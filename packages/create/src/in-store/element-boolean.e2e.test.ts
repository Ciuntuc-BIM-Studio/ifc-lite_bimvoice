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

  it('a united wall stays a wall: recognized natively, edited on its own solid, the union kept', async () => {
    const { store, view, editor, a, b, mesh } = await crossing();
    expect(booleans.bakeBooleanInStore(store, editor, a, [b], 'UNION').ok).toBe(true);
    editor.deleteEntity?.(b);
    const { liftNativeModel } = await import('../native/lift.js');
    const { nativeElementQuantities } = await import('../native/element-quantities.js');
    const { setWallSectionInStore } = await import('./wall-section-edit.js');
    const lifted = liftNativeModel(store, view, { id: '00000000-0000-4000-8000-000000000000', name: '' });
    const wall = lifted.model.elements.find((e) => lifted.expressIds.get(e.id) === a);
    expect(wall, JSON.stringify(lifted.skipped.filter((k) => k.expressId === a))).toMatchObject({ kind: 'wall', combined: 'union', thickness: 0.2, height: 3 });
    // Its quantities: the lengths of its own solid, no area or volume the union would make wrong.
    expect(nativeElementQuantities(store, view, a)?.quantities.map((q) => q.name)).toEqual(['Length', 'Width', 'Height']);
    // A height edit reaches its own solid; the tool's part stays 5 m high.
    expect(setWallSectionInStore({ dataStore: store, view, editor }, a, { height: 3.5 }).ok).toBe(true);
    const again = liftNativeModel(store, view, { id: '00000000-0000-4000-8000-000000000000', name: '' });
    expect(again.model.elements.find((e) => again.expressIds.get(e.id) === a)).toMatchObject({ height: 3.5, combined: 'union' });
    const box = bounds(await mesh(a));
    expect(box.up[1]).toBeCloseTo(5, 3);
    expect(box.x[1]).toBeCloseTo(4, 3);
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

  it('unites live: the tool stays an element, edited the union follows it; separated the target is its own again', async () => {
    const { store, view, editor, anchor, a, b, mesh } = await crossing();
    const combine = await import('./element-combine.js');
    const { setWallSectionInStore } = await import('./wall-section-edit.js');
    expect(combine.combineElementsInStore(store, editor, anchor, a, [b], 'UNION')).toEqual({ ok: true, remesh: [a, b] });
    // Tied once: again is refused, and the tool cannot be another's tool too.
    expect(combine.combineElementsInStore(store, editor, anchor, a, [b], 'UNION').ok).toBe(false);
    expect(combine.readCombinations(store, view)).toMatchObject([{ target: a, tool: b, op: 'UNION' }]);
    expect(bounds(await mesh(a)).up[1]).toBeCloseTo(5, 3);
    // The tool is still a wall, still editable; the target follows when written again.
    expect(setWallSectionInStore({ dataStore: store, view, editor }, b, { height: 6 }).ok).toBe(true);
    expect(combine.rebakeCombinationInStore(store, editor, a).ok).toBe(true);
    expect(bounds(await mesh(a)).up[1]).toBeCloseTo(6, 3);
    expect(bounds(await mesh(b)).up[1]).toBeCloseTo(6, 3);
    // Written again twice: still one union over its own body, not a union of unions.
    expect(combine.rebakeCombinationInStore(store, editor, a).ok).toBe(true);
    const { combinationOf } = await import('./body-trim.js');
    const { AnchorEntityReader } = await import('./resolve-anchor.js');
    const r = new AnchorEntityReader(store, view);
    const top = booleans.bodyOf(r, a)!.items[0];
    expect(combinationOf((id) => r.entity(id), top)).toBe('union');
    expect(combinationOf((id) => r.entity(id), Number(String(r.entity(top)!.attributes[1]).replace('#', '')))).toBeNull();
    // Separated: the target is its own 3 m wall again, the tool untouched.
    expect(combine.separateCombinationsInStore(store, editor, [a]).sort()).toEqual([a, b].sort());
    expect(combine.readCombinations(store, view)).toEqual([]);
    expect(bounds(await mesh(a)).up[1]).toBeCloseTo(3, 3);
    expect(bounds(await mesh(b)).up[1]).toBeCloseTo(6, 3);
  });

  it('intersects live: what both hold, following the tool', async () => {
    const { store, view, editor, anchor, a, b, mesh } = await crossing();
    const combine = await import('./element-combine.js');
    const { setWallSectionInStore } = await import('./wall-section-edit.js');
    expect(combine.combineElementsInStore(store, editor, anchor, a, [b], 'INTERSECTION').ok).toBe(true);
    expect(bounds(await mesh(a)).x).toEqual([expect.closeTo(1.8, 3), expect.closeTo(2.2, 3)]);
    expect(setWallSectionInStore({ dataStore: store, view, editor }, b, { thickness: 1 }).ok).toBe(true);
    expect(combine.rebakeCombinationInStore(store, editor, a).ok).toBe(true);
    expect(bounds(await mesh(a)).x).toEqual([expect.closeTo(1.5, 3), expect.closeTo(2.5, 3)]);
  });

  it('exports a live union once: the tool is part of the target, not an element of its own, nothing pointing at it', async () => {
    const { store, view, editor, anchor, a, b } = await crossing();
    const combine = await import('./element-combine.js');
    expect(combine.combineElementsInStore(store, editor, anchor, a, [b], 'UNION').ok).toBe(true);
    // As the app exports: on a copy, so the session keeps its tool.
    const copy = view.detachedCopy();
    const omitted = combine.omitCombinedToolsInStore(store, new StoreEditor(store, copy));
    expect(omitted).toContain(b);
    expect(view.isDeleted(b)).toBe(false);
    const bytes = new StepExporter(store, copy).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array;
    const text = new TextDecoder().decode(bytes);
    const ids = new Set([...text.matchAll(/^#(\d+)=/gm)].map((m) => Number(m[1])));
    const dangling = [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1])).filter((id) => !ids.has(id));
    expect([...new Set(dangling)]).toEqual([]);
    expect(ids.has(b)).toBe(false);
    expect(text).not.toMatch(/Lapin union/);
    // No orphaned geometry of the tool: every placement, shape and representation is used.
    const refs = new Set([...text.matchAll(/=.*$/gm)].flatMap((m) => [...m[0].matchAll(/#(\d+)/g)].map((r) => Number(r[1]))));
    const orphans = [...text.matchAll(/^#(\d+)=(IFCLOCALPLACEMENT|IFCPRODUCTDEFINITIONSHAPE|IFCSHAPEREPRESENTATION)\(/gm)].filter((m) => !refs.has(Number(m[1])));
    expect(orphans.map((m) => m[0])).toEqual([]);
    // The target carries the tool's body: as high as the tool.
    const back = await parse(bytes);
    const box = bounds(vertices(bytes, back, a));
    expect(box.up[1]).toBeCloseTo(5, 3);
    expect(box.x).toEqual([expect.closeTo(0, 3), expect.closeTo(4, 3)]);
  });
});
