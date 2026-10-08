/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A roof system written into a real model, exported, re-parsed and meshed
 * by the real WASM engine; then regenerated with other rules, keeping the
 * GlobalIds of the parts that are still generated. */
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

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  { disableWorkerScan: true },
);

function meshZ(bytes: Uint8Array, store: IfcDataStore, id: number): { min: number; max: number; meshes: number } {
  const api = new RuntimeIfcAPI();
  try {
    const ref = store.entityIndex.byId.get(id)!;
    const pre = api.buildPrePassOnce(bytes);
    const c = api.processGeometryBatch(bytes, new Uint32Array([id, ref.byteOffset, ref.byteOffset + ref.byteLength]), pre.unitScale, 0, 0, 0, false,
      pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
    let min = Infinity, max = -Infinity, meshes = 0;
    try {
      for (let i = 0; i < c.length; i++) {
        const m = c.takeMesh(i);
        if (!m) continue;
        try {
          meshes++;
          for (let j = 1; j < m.positions.length; j += 3) { const z = m.origin[1] + m.positions[j]; min = Math.min(min, z); max = Math.max(max, z); }
        } finally { m.free(); }
      }
    } finally { c.free(); }
    return { min, max, meshes };
  } finally {
    try { api.clearPrePassCache(); } finally { api.free(); }
  }
}

const spec = (pitch: number): RoofSystemSpec => ({
  name: 'Roof', outline: [[0, 0], [10, 0], [10, 6], [0, 6]], eaveHeight: 3,
  rules: [{ kind: 'eave', pitch, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }, { kind: 'eave', pitch, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }],
  covering: { thickness: 0.08, color: '#a0522d' }, structure: defaultRoofStructure(), timberColor: '#c8a070',
});

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('roof system block, real WASM meshes', () => {
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    ({ MutablePropertyView, StoreEditor } = await import('@ifc-lite/mutations'));
    ({ StepExporter } = await import('@ifc-lite/export'));
    ({ resolveSpatialAnchor } = await import('./resolve-anchor.js'));
    roofs = await import('./roof-system-store.js');
  }, 60_000);

  it('writes an IfcRoof aggregating covering planes and members, meshed at the right heights, and regenerates in place', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyId, view);
    const made = roofs.addRoofSystemToStore(editor, anchor, spec(30));
    expect(roofs.readRoofSystem(store, made.roofId, view)?.rules[0].pitch).toBe(30);
    expect(roofs.roofSystemOf(store, made.parts[0], view)).toBe(made.roofId);

    let bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    let text = new TextDecoder().decode(bytes);
    expect(text).toContain("IFCROOF('");
    expect(text).toContain('.GABLE_ROOF.');
    expect(text).toContain('IFCRELAGGREGATES(');
    expect(text).toContain('.RAFTER.');
    expect(text).toContain("'Pset_IfcLiteRoofSystem'");
    let reparsed = await parse(bytes);
    expect(roofs.readRoofSystem(reparsed, made.roofId)?.name).toBe('Roof');
    const plane = made.parts[0];
    const ridgeTop = 3 + 3 * Math.tan(Math.PI / 6);
    const covering = meshZ(bytes, reparsed, plane);
    expect(covering.meshes).toBeGreaterThan(0);
    expect(covering.max).toBeCloseTo(ridgeTop, 2);
    expect(covering.min).toBeCloseTo(3 - 0.5 * Math.tan(Math.PI / 6) - 0.08 / Math.cos(Math.PI / 6), 2);
    const rafter = made.parts.find((id) => String(view.getNewEntity(id)?.attributes[7]).startsWith('rafter:'))!;
    const r = meshZ(bytes, reparsed, rafter);
    expect(r.meshes).toBeGreaterThan(0);
    expect(r.max).toBeLessThan(ridgeTop);

    // Steeper: same planes (same keys), rafters and purlins rebuilt, the ridge higher.
    const planeGuid = view.getNewEntity(plane)!.attributes[0];
    const again = roofs.regenerateRoofSystemInStore(store, editor, anchor, made.roofId, spec(45));
    expect(again.parts).toContain(plane);
    bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    text = new TextDecoder().decode(bytes);
    expect(text).toContain(`'${planeGuid}'`);
    reparsed = await parse(bytes);
    expect(roofs.readRoofSystem(reparsed, made.roofId)?.rules[0].pitch).toBe(45);
    expect(meshZ(bytes, reparsed, plane).max).toBeCloseTo(3 + 3, 2);
    // Fewer parts: no structure at all.
    const bare = roofs.regenerateRoofSystemInStore(store, editor, anchor, made.roofId, { ...spec(45), structure: { ...defaultRoofStructure(), system: 'none' } });
    expect(bare.parts).toHaveLength(2);
    expect(bare.removed.length).toBeGreaterThan(10);
    for (const id of bare.removed) expect(view.isDeleted(id) || !view.getNewEntity(id)).toBe(true);
  });
});
