/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A wall attached to a gable roof, exported, re-parsed and meshed by the real WASM engine: only what is under the roof stays. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { IfcAPI } from '@ifc-lite/wasm';
import { defaultRoofStructure } from './roof-structure.js';
import type { RoofSystemSpec } from './roof-system-store.js';

const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));
let RuntimeIfcAPI: typeof IfcAPI;
let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let MutablePropertyView: typeof import('@ifc-lite/mutations').MutablePropertyView;
let StoreEditor: typeof import('@ifc-lite/mutations').StoreEditor;
let StepExporter: typeof import('@ifc-lite/export').StepExporter;
let resolveSpatialAnchor: typeof import('./resolve-anchor.js').resolveSpatialAnchor;
let roofs: typeof import('./roof-system-store.js');
let walls: typeof import('./wall.js');
let trims: typeof import('./wall-roof-trim.js');
let sizes: typeof import('./wall-size-edit.js');

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

const RIDGE = 3 + 3 * Math.tan(Math.PI / 6);
const UNDER_COVERING = 0.08 / Math.cos(Math.PI / 6);

// A 10 × 6 m gable roof (ridge along x at y = 3), wall plate at 3 m.
const spec: RoofSystemSpec = {
  name: 'Roof', outline: [[0, 0], [10, 0], [10, 6], [0, 6]], eaveHeight: 3,
  rules: [{ kind: 'eave', pitch: 30, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }, { kind: 'eave', pitch: 30, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }],
  covering: { thickness: 0.08, color: '#a0522d' }, structure: { ...defaultRoofStructure(), system: 'none' }, timberColor: '#c8a070',
};

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('a wall attached to a roof, real WASM meshes', () => {
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveSpatialAnchor } = await import('./resolve-anchor.js'));
    roofs = await import('./roof-system-store.js');
    walls = await import('./wall.js');
    trims = await import('./wall-roof-trim.js');
    sizes = await import('./wall-size-edit.js');
  }, 60_000);

  it('rises to the roof and keeps only what is under it; stays editable; detaches back to a plain wall', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyId, view);
    const roof = roofs.addRoofSystemToStore(editor, anchor, spec);
    // A cross wall under the ridge, from eave to eave, 2.5 m high.
    const wall = walls.addWallToStore(editor, anchor, { Start: [5, 0, 0], End: [5, 6, 0], Thickness: 0.2, Height: 2.5 });

    trims.setWallRoofTrimInStore(store, editor, anchor, wall.wallId, { roof: roof.globalId, top: 'covering' });
    expect(trims.readWallRoofTrim(store, wall.wallId, view)).toEqual({ roof: roof.globalId, top: 'covering' });
    expect(trims.roofTrimmedWalls(store, view, roof.globalId).map((w) => w.wallId)).toEqual([wall.wallId]);

    const meshed = async () => {
      const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
      const reparsed = await parse(bytes);
      return { bytes, reparsed, text: new TextDecoder().decode(bytes), v: vertices(bytes, reparsed, wall.wallId) };
    };
    let { text, v } = await meshed();
    expect(text).toContain('IFCPOLYGONALBOUNDEDHALFSPACE(');
    expect(text).toContain("'Pset_IfcLiteRoofTrim'");
    expect(v.length).toBeGreaterThan(0);
    const top = () => Math.max(...v.map((p) => p[1]));
    // Up to the roof's underside at the ridge; at its ends, the underside at the wall plate.
    expect(top()).toBeCloseTo(RIDGE - UNDER_COVERING, 2);
    const along = v.map((p) => p[2]);
    const lo = Math.min(...along), hi = Math.max(...along);
    for (const end of [lo, hi]) {
      const atEnd = v.filter((p) => Math.abs(p[2] - end) < 1e-3).map((p) => p[1]);
      expect(Math.max(...atEnd)).toBeCloseTo(3 - UNDER_COVERING, 2);
    }

    // Its axis still reads through the trim, and an edit keeps it attached once re-synced.
    const metres = sizes.readWallMetres({ dataStore: store, view, editor }, wall.wallId);
    expect(metres?.start).toEqual([5, 0, 0]);
    const resized = sizes.resizeWallInStore({ dataStore: store, view, editor }, wall.wallId, [5, 1, 0], [5, 6, 0]);
    expect(resized.ok).toBe(true);
    expect(trims.syncWallRoofTrimInStore(store, editor, wall.wallId)).toBe(true);
    ({ v } = await meshed());
    expect(top()).toBeCloseTo(RIDGE - UNDER_COVERING, 2);
    const ends = v.map((p) => p[2]);
    expect(Math.max(...ends) - Math.min(...ends)).toBeCloseTo(5, 2);

    // Detached: a plain extrusion again, as high as the roof was.
    trims.setWallRoofTrimInStore(store, editor, anchor, wall.wallId, null);
    ({ text, v } = await meshed());
    expect(text).not.toContain('IFCPOLYGONALBOUNDEDHALFSPACE(');
    expect(text).not.toContain("'Pset_IfcLiteRoofTrim'");
    expect(top()).toBeCloseTo(RIDGE - UNDER_COVERING, 2);
    expect(Math.min(...v.map((p) => p[1]))).toBeCloseTo(0, 3);
  });
});
