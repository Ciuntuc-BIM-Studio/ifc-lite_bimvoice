/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A joinery type written into a real model, a window hosted in its wall
 * mapping the type's body, exported, re-parsed and meshed by the real WASM
 * geometry engine: the mesh is the configured size, in the opening. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { IfcAPI } from '@ifc-lite/wasm';
import { defaultWindowSpec } from './joinery-spec.js';

const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));
const WALL = 1222;
let RuntimeIfcAPI: typeof IfcAPI;
let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let MutablePropertyView: typeof import('@ifc-lite/mutations').MutablePropertyView;
let StoreEditor: typeof import('@ifc-lite/mutations').StoreEditor;
let StepExporter: typeof import('@ifc-lite/export').StepExporter;
let resolveHostAnchor: typeof import('./resolve-host.js').resolveHostAnchor;
let addHostedElementInStore: typeof import('./hosted-element.js').addHostedElementInStore;
let addJoineryTypeToStore: typeof import('./joinery-type.js').addJoineryTypeToStore;
let assignTypeInStore: typeof import('./element-type.js').assignTypeInStore;
let readJoineryType: typeof import('./joinery-read.js').readJoineryType;
let readJoineryFlips: typeof import('./joinery-read.js').readJoineryFlips;
let sync: typeof import('./joinery-sync.js');

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  { disableWorkerScan: true },
);

function meshStats(bytes: Uint8Array, store: IfcDataStore, id: number) {
  const api = new RuntimeIfcAPI();
  try {
    const ref = store.entityIndex.byId.get(id);
    if (!ref) throw new Error(`Expected exported entity #${id}`);
    const pre = api.buildPrePassOnce(bytes);
    const collection = api.processGeometryBatch(bytes,
      new Uint32Array([id, ref.byteOffset, ref.byteOffset + ref.byteLength]), pre.unitScale, 0, 0, 0, false,
      pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let meshes = 0, transparent = 0;
    try {
      for (let i = 0; i < collection.length; i++) {
        const mesh = collection.takeMesh(i);
        if (!mesh) continue;
        try {
          meshes++;
          if (mesh.color[3] < 0.99) transparent++;
          const p = mesh.positions, o = mesh.origin;
          for (let j = 0; j < p.length; j += 3) {
            const v = [o[0] + p[j], -(o[2] + p[j + 2]), o[1] + p[j + 1]];
            for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
          }
        } finally { mesh.free(); }
      }
    } finally { collection.free(); }
    return { min, max, meshes, transparent };
  } finally {
    try { api.clearPrePassCache(); } finally { api.free(); }
  }
}

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('joinery type → mapped window, real WASM mesh', () => {
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveHostAnchor } = await import('./resolve-host.js'));
    ({ addHostedElementInStore } = await import('./hosted-element.js'));
    ({ addJoineryTypeToStore } = await import('./joinery-type.js'));
    ({ assignTypeInStore } = await import('./element-type.js'));
    ({ readJoineryType, readJoineryFlips } = await import('./joinery-read.js'));
    sync = await import('./joinery-sync.js');
  }, 60_000);

  it('meshes the configured window in its opening, glass translucent', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const spec = { ...defaultWindowSpec("W-120 l'atelier"), board: { interior: 0, exterior: 0 } };
    const host = resolveHostAnchor(store, WALL, view);
    const type = addJoineryTypeToStore(editor, host, spec);
    const placed = addHostedElementInStore(store, editor, WALL, {
      kind: 'window', params: { Offset: 8.5, Sill: 0.9, Width: spec.width, Height: spec.height, MappedBody: type.mapId },
    });
    assignTypeInStore(editor, host, type.typeId, [placed.expressId], []);

    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    const text = new TextDecoder().decode(bytes);
    expect(text).toMatch(/IFCWINDOWTYPE\('[^']+',[^;]*'W-120 l''atelier'/);
    expect(text).toContain('IFCWINDOWLININGPROPERTIES(');
    expect(text).toContain('.TILTANDTURNLEFTHAND.');
    expect(text).toContain("'Pset_IfcLiteJoinery'");
    expect(readJoineryType(store, type.typeId, view)?.spec).toEqual(spec);
    const reparsed = await parse(bytes);
    const read = readJoineryType(reparsed, type.typeId);
    expect(read?.spec).toEqual(spec);
    expect(read?.mapId).toBe(type.mapId);
    const stats = meshStats(bytes, reparsed, placed.expressId);
    expect(stats.meshes).toBeGreaterThan(1);
    expect(stats.transparent).toBeGreaterThan(0);
    expect(stats.max[0] - stats.min[0]).toBeCloseTo(spec.width, 3);
    expect(stats.max[2] - stats.min[2]).toBeCloseTo(spec.height, 3);
    expect((stats.min[0] + stats.max[0]) / 2).toBeCloseTo(8.5, 3);
    expect(stats.min[2]).toBeCloseTo(0.9, 3);
  });

  it('places by catalogue entry, then rewrites the type and refits its occurrences', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const spec = { ...defaultWindowSpec('W-A'), id: 'cat-1', board: { interior: 0, exterior: 0 } };
    const type = sync.ensureJoineryTypeInStore(store, editor, spec);
    expect(sync.ensureJoineryTypeInStore(store, editor, spec).typeId).toBe(type.typeId);
    const placed = addHostedElementInStore(store, editor, WALL, {
      kind: 'window', params: { Offset: 8.5, Sill: 0.9, Width: spec.width, Height: spec.height, MappedBody: type.mapId },
    });
    assignTypeInStore(editor, resolveHostAnchor(store, WALL, view), type.typeId, [placed.expressId], []);
    const wider = { ...spec, width: 1.5, height: 1.2, columns: [1, 1, 1] };
    const result = sync.syncJoineryTypeInStore(store, editor, wider);
    expect(result.refused).toEqual([]);
    expect(result.remesh).toContain(placed.expressId);
    expect(readJoineryType(store, type.typeId, view)?.spec.columns).toHaveLength(3);
    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    const reparsed = await parse(bytes);
    const stats = meshStats(bytes, reparsed, placed.expressId);
    expect(stats.max[0] - stats.min[0]).toBeCloseTo(1.5, 3);
    expect(stats.max[2] - stats.min[2]).toBeCloseTo(1.2, 3);
    expect(stats.min[2]).toBeCloseTo(0.9, 3);
    const opening = meshStats(bytes, reparsed, placed.openingId);
    expect(opening.max[0] - opening.min[0]).toBeCloseTo(1.5, 3);
  });

  it('turns and mirrors an occurrence through its mapped item, readable back', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const spec = { ...defaultWindowSpec('W-F'), id: 'cat-f', board: { interior: 0.3, exterior: 0 } };
    const type = sync.ensureJoineryTypeInStore(store, editor, spec);
    const placed = addHostedElementInStore(store, editor, WALL, {
      kind: 'window', params: { Offset: 8.5, Sill: 0.9, Width: spec.width, Height: spec.height, MappedBody: type.mapId },
    });
    assignTypeInStore(editor, resolveHostAnchor(store, WALL, view), type.typeId, [placed.expressId], []);
    const yExtent = async () => {
      const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
      const s = meshStats(bytes, await parse(bytes), placed.expressId);
      return [s.min[1], s.max[1]];
    };
    const [min0, max0] = await yExtent();
    // The interior board reaches 0.3 m out on the −Y side.
    expect(max0 - min0).toBeGreaterThan(0.3);
    expect(sync.setJoineryFlipsInStore(store, editor, placed.expressId, 2)).toBe(true);
    expect(readJoineryFlips(store, placed.expressId, view)).toBe(2);
    const [min2, max2] = await yExtent();
    // Turned 180° about the vertical through the wall's centre plane (y = 0.05): the board is now on +Y.
    expect(min2).toBeCloseTo(0.1 - max0, 3);
    expect(max2).toBeCloseTo(0.1 - min0, 3);
    for (const f of [1, 3, 0]) {
      sync.setJoineryFlipsInStore(store, editor, placed.expressId, f);
      expect(readJoineryFlips(store, placed.expressId, view)).toBe(f);
    }
  });
});