/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A timber truss written into a real model, exported, re-parsed and meshed by the real WASM engine; then regenerated with another pattern, keeping the GlobalIds of the bars still generated. */
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
let trusses: typeof import('./truss-store.js');
let geometry: typeof import('./truss.js');

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
});

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('timber truss, real WASM meshes', () => {
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveSpatialAnchor } = await import('./resolve-anchor.js'));
    trusses = await import('./truss-store.js');
    geometry = await import('./truss.js');
  }, 60_000);

  it('writes an IfcElementAssembly TRUSS of timber members, meshed in place, and regenerates it keeping the chords', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyId, view);
    const spec = { ...geometry.defaultTimberTruss(), overhang: 0, name: 'T1', start: [0, 0, 3] as [number, number, number], end: [8, 0, 3] as [number, number, number] };
    const made = trusses.addTrussToStore(store, editor, anchor, spec);
    expect(made.parts).toHaveLength(7);
    expect(trusses.trussOf(store, made.parts[0], view)).toBe(made.trussId);
    expect(trusses.readTruss(store, made.trussId, view)?.span).toBe(8);

    let bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    let text = new TextDecoder().decode(bytes);
    expect(text).toContain('.TRUSS.');
    expect(text).toContain("'Pset_LapinTruss'");
    expect(text).toContain("'Timber C24'");
    let reparsed = await parse(bytes);
    // The bottom chord: 8 m along x at 3 m; the apex 2 m higher.
    const bottom = bounds(vertices(bytes, reparsed, made.parts[0]));
    expect(bottom.x[1] - bottom.x[0]).toBeCloseTo(8, 2);
    const all = made.parts.flatMap((id) => vertices(bytes, reparsed, id));
    expect(Math.max(...all.map((p) => p[1]))).toBeGreaterThan(4.9);

    // Howe with 4 panels: the chords keep their entities and GlobalIds; the fink webs go.
    const guidOf = (id: number) => String(view.getNewEntity(id)?.attributes[0]);
    const chordGuids = made.parts.slice(0, 3).map(guidOf);
    const again = trusses.regenerateTrussInStore(store, editor, anchor, made.trussId, { ...spec, pattern: 'howe' });
    expect(again.parts.slice(0, 3)).toEqual(made.parts.slice(0, 3));
    expect(again.parts.slice(0, 3).map(guidOf)).toEqual(chordGuids);
    expect(again.removed).toHaveLength(4);
    bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    text = new TextDecoder().decode(bytes);
    reparsed = await parse(bytes);
    for (const id of again.parts) expect(vertices(bytes, reparsed, id).length).toBeGreaterThan(0);
    expect(trusses.readTruss(reparsed, made.trussId)?.pattern).toBe('howe');

    // Asked to stand elsewhere, it stays where its bottom chord is (moving it is Move's, not the spec's).
    const moved = trusses.regenerateTrussInStore(store, editor, anchor, made.trussId, { ...spec, pattern: 'howe', start: [50, 50, 0], end: [51, 50, 0] });
    expect(trusses.readPlacedTruss(store, editor, moved.trussId)?.start.map((v) => +v.toFixed(6))).toEqual([0, 0, 3]);
    expect(trusses.readPlacedTruss(store, editor, moved.trussId)?.span).toBeCloseTo(8, 6);
  });
});
