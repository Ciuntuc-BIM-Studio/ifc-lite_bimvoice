/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A terrain and a corridor written into a real model (IFC4 sample, and a
 * fresh IFC4X3 project where the alignment is written too), read back,
 * regenerated in place keeping the parts' GlobalIds, removed whole; and the
 * courses meshed by the real WASM engine at the profile's height.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcAPI } from '@ifc-lite/wasm';
import { IfcCreator } from '../ifc-creator.js';
import { defaultAssembly, defaultDesign } from '../civil/assembly.js';
import { delaunay, type V3 } from '../civil/tin.js';
import type { CorridorSpec } from '../civil/corridor.js';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import {
  addCorridorToStore, addTerrainToStore, corridorOf, corridorParts, corridorsInStore, readCorridor, readTerrainTin, regenerateCorridorInStore, removeCorridorFromStore, terrainsInStore,
} from './corridor-store.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);
const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  { disableWorkerScan: true },
);

function groundTin() {
  const pts: V3[] = [];
  for (let x = -50; x <= 250; x += 25) for (let y = -50; y <= 250; y += 25) pts.push([x, y, 0.5 + x * 0.01]);
  return delaunay(pts);
}

const spec = (name = 'Road'): CorridorSpec => ({
  name, alignment: { pis: [{ x: 0, y: 0 }, { x: 150, y: 0, radius: 60 }, { x: 150, y: 150 }] },
  profile: { pvis: [{ station: 0, elevation: 2 }, { station: 300, elevation: 3 }] }, assembly: defaultAssembly(), design: defaultDesign(), interval: 10,
});

async function ifc4x3Scene() {
  const creator = new IfcCreator({ Schema: 'IFC4X3', Name: 'Road project' });
  creator.addIfcBuildingStorey({ Name: 'Ground', Elevation: 0 });
  const bytes = new TextEncoder().encode(creator.toIfc().content);
  const store = await parse(bytes);
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const storeyId = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
  const anchor = resolveSpatialAnchor(store, storeyId, view);
  return { store, view, editor, anchor };
}

describe('corridor in store', () => {
  it('IFC4: terrain, corridor with courses and slopes, read back, regenerated in place, removed whole', async () => {
    const store = await parse(readFileSync(SAMPLE));
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const anchor = resolveSpatialAnchor(store, 42, view);
    const terrain = addTerrainToStore(editor, anchor, { Name: 'EG', tin: groundTin() });
    expect(terrainsInStore(store, view).map((t) => t.id)).toEqual([terrain.elementId]);
    const back = readTerrainTin(store, anchor, terrain.elementId, view)!;
    expect(back.points).toHaveLength(groundTin().points.length);
    expect(back.triangles).toHaveLength(groundTin().triangles.length);

    const made = addCorridorToStore(store, editor, anchor, { ...spec(), terrainGlobalId: terrain.globalId }, back);
    expect(made.alignmentId).toBeNull();
    expect(made.parts).toHaveLength(5);
    const types = made.parts.map((id) => view.getNewEntity(id)!.type);
    expect(types.filter((t) => t === 'IfcBuildingElementProxy')).toHaveLength(4);
    expect(types).toContain('IfcGeographicElement');
    expect(readCorridor(store, made.corridorId, view)?.name).toBe('Road');
    expect(corridorOf(store, made.parts[2], view)).toBe(made.corridorId);
    expect(corridorsInStore(store, view)).toEqual([made.corridorId]);
    expect(made.model.volumes.fill).toBeGreaterThan(0);

    const guids = made.parts.map((id) => view.getNewEntity(id)!.attributes[0]);
    const fewer = { ...spec('Road B'), assembly: { ...defaultAssembly(), layers: defaultAssembly().layers.slice(0, 2) } };
    const again = regenerateCorridorInStore(store, editor, anchor, made.corridorId, fewer, back);
    expect(again.parts).toHaveLength(3);
    expect(again.removed).toHaveLength(2);
    expect(again.parts.slice(0, 2).map((id) => view.getNewEntity(id)!.attributes[0])).toEqual(guids.slice(0, 2));
    expect(readCorridor(store, made.corridorId, view)?.name).toBe('Road B');
    expect(corridorParts(store, made.corridorId, view)).toEqual(again.parts);

    const removed = removeCorridorFromStore(store, editor, made.corridorId);
    expect(removed).toHaveLength(4);
    expect(corridorsInStore(store, view)).toEqual([]);
    expect(view.getNewEntities().filter((e) => !view.isDeleted(e.expressId) && /^IfcTriangulatedFaceSet$/.test(e.type))).toHaveLength(1);
  });

  it('IFC4X3: courses are IfcCourse, slopes IfcEarthworksFill, and the alignment is written with both layouts', async () => {
    const { store, view, editor, anchor } = await ifc4x3Scene();
    const made = addCorridorToStore(store, editor, anchor, spec(), groundTin());
    expect(made.alignmentId).not.toBeNull();
    const live = () => view.getNewEntities().filter((e) => !view.isDeleted(e.expressId));
    const count = (type: string) => live().filter((e) => e.type === type).length;
    expect(count('IfcCourse')).toBe(4);
    expect(count('IfcEarthworksFill')).toBe(1);
    expect(count('IfcAlignment')).toBe(1);
    expect(count('IfcAlignmentHorizontal')).toBe(1);
    expect(count('IfcAlignmentVertical')).toBe(1);
    expect(count('IfcAlignmentHorizontalSegment')).toBe(4);
    expect(count('IfcGradientCurve')).toBe(1);
    expect(count('IfcReferent')).toBe(1);
    const alignmentGuid = view.getNewEntity(made.alignmentId!)!.attributes[0];
    const again = regenerateCorridorInStore(store, editor, anchor, made.corridorId, spec('Road 2'), groundTin());
    expect(count('IfcAlignment')).toBe(1);
    expect(count('IfcAlignmentHorizontalSegment')).toBe(4);
    expect(view.getNewEntity(again.alignmentId!)!.attributes[0]).toBe(alignmentGuid);
    removeCorridorFromStore(store, editor, made.corridorId);
    expect(count('IfcAlignment')).toBe(0);
    expect(count('IfcCurveSegment')).toBe(0);
    expect(count('IfcCourse')).toBe(0);
  });
});

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('corridor, real WASM meshes', () => {
  let RuntimeIfcAPI: typeof IfcAPI;
  let StepExporter: typeof import('@ifc-lite/export').StepExporter;
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ StepExporter } = await import('@ifc-lite/export'));
  }, 60_000);

  function meshZ(bytes: Uint8Array, store: IfcDataStore, id: number): { min: number; max: number; triangles: number } {
    const api = new RuntimeIfcAPI();
    try {
      const ref = store.entityIndex.byId.get(id)!;
      const pre = api.buildPrePassOnce(bytes);
      const c = api.processGeometryBatch(bytes, new Uint32Array([id, ref.byteOffset, ref.byteOffset + ref.byteLength]), pre.unitScale, 0, 0, 0, false,
        pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
      let min = Infinity, max = -Infinity, triangles = 0;
      try {
        for (let i = 0; i < c.length; i++) {
          const m = c.takeMesh(i);
          if (!m) continue;
          try {
            triangles += m.indices.length / 3;
            for (let j = 1; j < m.positions.length; j += 3) { const z = m.origin[1] + m.positions[j]; min = Math.min(min, z); max = Math.max(max, z); }
          } finally { m.free(); }
        }
      } finally { c.free(); }
      return { min, max, triangles };
    } finally {
      try { api.clearPrePassCache(); } finally { api.free(); }
    }
  }

  it('meshes the wearing course along the whole road at the profile grade, and the terrain', async () => {
    const { store, view, editor, anchor } = await ifc4x3Scene();
    const terrain = addTerrainToStore(editor, anchor, { Name: 'EG', tin: groundTin() });
    const made = addCorridorToStore(store, editor, anchor, spec(), groundTin());
    const bytes = new StepExporter(store, view).export({ schema: 'IFC4X3', applyMutations: true }).content;
    const reparsed = await parse(bytes);
    const wearing = meshZ(bytes, reparsed, made.parts[0]);
    expect(wearing.triangles).toBeGreaterThan(100);
    // The road climbs from 2 to about 2.9 m over its length; the course is 4 cm thick and the shoulders fall 4 %.
    expect(wearing.min).toBeGreaterThan(1.6);
    expect(wearing.max).toBeLessThan(3.0);
    expect(wearing.max - wearing.min).toBeGreaterThan(0.7);
    const ground = meshZ(bytes, reparsed, terrain.elementId);
    expect(ground.triangles).toBe(groundTin().triangles.length);
    expect(ground.min).toBeCloseTo(0, 3);
    expect(ground.max).toBeCloseTo(3, 3);
  });
});
