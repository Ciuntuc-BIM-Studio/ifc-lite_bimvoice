/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A timber-framed wall with a window, exported, re-parsed and meshed by the real WASM engine; then unframed. */
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
let fills: typeof import('./hosted-fill.js');
let hosts: typeof import('./resolve-host.js');
let frames: typeof import('./timber-frame-store.js');
let layout: typeof import('./timber-frame.js');
let hosted: typeof import('./hosted-element.js');

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


describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('timber-framed wall, real WASM meshes', () => {
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveSpatialAnchor } = await import('./resolve-anchor.js'));
    walls = await import('./wall.js');
    fills = await import('./hosted-fill.js');
    hosts = await import('./resolve-host.js');
    frames = await import('./timber-frame-store.js');
    layout = await import('./timber-frame.js');
    hosted = await import('./hosted-element.js');
  }, 60_000);

  it('shows the frame instead of the wall, keeps the window clear, and comes off again', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyId, view);
    const wall = walls.addWallToStore(editor, anchor, { Start: [0, 0, 0], End: [5, 0, 0], Thickness: 0.2, Height: 2.6 }).wallId;
    fills.addHostedWindowToStore(editor, hosts.resolveHostAnchor(store, wall, view), { Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.2 });
    const cut = hosted.readHostOpeningExtents(store, wall, view).cuts[0].bounds;
    const win = { x0: cut.min[0], x1: cut.max[0], z0: cut.min[2], z1: cut.max[2] };

    const framed = frames.setTimberFrameInStore(store, editor, anchor, wall, layout.defaultTimberFrame());
    expect(frames.readTimberFrame(store, wall, view)?.grade).toBe('C24');
    const pieces = frames.timberFramePieces(store, wall, view);
    expect(pieces.length).toBeGreaterThan(15);
    expect(framed.remesh).toContain(wall);

    let bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    let text = new TextDecoder().decode(bytes);
    expect(text).toContain("'Pset_LapinTimberFrame'");
    expect(text).toContain('.STUD.');
    expect(text).toContain('.SHEET.');
    expect(text).toContain("IFCMATERIAL('OSB'");
    let reparsed = await parse(bytes);
    expect(vertices(bytes, reparsed, wall)).toHaveLength(0);
    // Render space: x along the wall, y up; nothing strictly inside the window.
    for (const id of pieces) {
      const v = vertices(bytes, reparsed, id);
      expect(v.length).toBeGreaterThan(0);
      const xs = v.map((p) => p[0]), ys = v.map((p) => p[1]);
      const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...ys), z1: Math.max(...ys) };
      const inside = box.x0 < win.x1 - 1e-3 && win.x0 < box.x1 - 1e-3 && box.z0 < win.z1 - 1e-3 && win.z0 < box.z1 - 1e-3;
      expect(inside, `piece #${id} in the window`).toBe(false);
    }

    const off = frames.setTimberFrameInStore(store, editor, anchor, wall, null);
    expect(off.removed.sort()).toEqual([...pieces].sort());
    bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    text = new TextDecoder().decode(bytes);
    expect(text).not.toContain("'Pset_LapinTimberFrame'");
    reparsed = await parse(bytes);
    expect(vertices(bytes, reparsed, wall).length).toBeGreaterThan(0);
  });
});
