/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Timber members written into a real model, exported, re-parsed and meshed by the real WASM engine. */
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
let timber: typeof import('./timber-member.js');

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

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('timber members, real WASM meshes', () => {
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveSpatialAnchor } = await import('./resolve-anchor.js'));
    timber = await import('./timber-member.js');
  }, 60_000);

  it('a post, a beam and a brace of one class share its material and carry their section', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyId, view);
    const post = timber.addTimberMemberToStore(store, editor, anchor, { kind: 'post', start: [0, 0, 0], end: [0, 0, 2.6], width: 0.14, depth: 0.14, grade: 'C24' });
    const beam = timber.addTimberMemberToStore(store, editor, anchor, { kind: 'beam', start: [0, 0, 2.5], end: [4, 0, 2.5], width: 0.12, depth: 0.24, grade: 'C24' });
    const brace = timber.addTimberMemberToStore(store, editor, anchor, { kind: 'brace', start: [0, 0, 1.6], end: [1, 0, 2.4], width: 0.1, depth: 0.1, grade: 'C24' });
    expect([post.ifcClass, beam.ifcClass, brace.ifcClass]).toEqual(['IfcColumn', 'IfcBeam', 'IfcMember']);

    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    const text = new TextDecoder().decode(bytes);
    expect(text.match(/IFCMATERIAL\('Timber C24'/g)).toHaveLength(1);
    expect(text).toContain("'Pset_LapinTimber'");
    expect(text).toContain('.BRACE.');
    const reparsed = await parse(bytes);
    // The class's material carries the timber colour, which the mesh takes.
    expect(text).toContain("'Timber C24'");
    expect(text).toMatch(/IFCMATERIALDEFINITIONREPRESENTATION\(/);
    const p = bounds(vertices(bytes, reparsed, post.id));
    expect(p.up[1] - p.up[0]).toBeCloseTo(2.6, 3);
    expect(p.x[1] - p.x[0]).toBeCloseTo(0.14, 3);
    const b = bounds(vertices(bytes, reparsed, beam.id));
    expect(b.x[1] - b.x[0]).toBeCloseTo(4, 3);
    expect(b.up[1] - b.up[0]).toBeCloseTo(0.24, 3);
    const r = bounds(vertices(bytes, reparsed, brace.id));
    // Inclined: it spans most of its rise and run.
    expect(r.up[1] - r.up[0]).toBeGreaterThan(0.8);
    expect(r.x[1] - r.x[0]).toBeGreaterThan(1);
  });
});
