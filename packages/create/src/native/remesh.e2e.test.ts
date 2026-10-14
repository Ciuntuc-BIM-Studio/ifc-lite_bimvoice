/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * N3: the native remesh (`planNativeRemesh` + `meshNativeElements`) puts the
 * same body in the same place as the IFC remesh (subgraph STEP + pre-pass +
 * `processGeometryBatch`), in the render frame both hand to the viewer.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MeshCollection } from '@ifc-lite/wasm';

const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));

let runtime: typeof import('@ifc-lite/wasm');
let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let mutations: typeof import('@ifc-lite/mutations');
let serializeEntitySubgraph: typeof import('@ifc-lite/export').serializeEntitySubgraph;
let create: typeof import('../index.js');
let resolveAnchor: typeof import('../in-store/resolve-anchor.js');
let plan: typeof import('./remesh-plan.js');

interface Body { volume: number; min: number[]; max: number[] }

/** Each express id's body (all its meshes), from a collection, render frame. */
function bodies(collection: MeshCollection): Map<string, Body> {
  const acc = new Map<string, { volume: number; min: number[]; max: number[] }>();
  for (let i = 0; i < collection.length; i++) {
    const m = collection.takeMesh(i);
    if (!m) continue;
    try {
      const o = Array.from(m.origin ?? [0, 0, 0]);
      const pos = m.positions, idx = m.indices;
      const key = `${m.expressId}:${(m as unknown as { materialId?: number }).materialId ?? ''}`;
      const b = acc.get(key) ?? { volume: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      const p = (k: number) => [0, 1, 2].map((a) => o[a] + pos[k * 3 + a]);
      for (let k = 0; k < pos.length / 3; k++) {
        const v = p(k);
        for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], v[a]); b.max[a] = Math.max(b.max[a], v[a]); }
      }
      for (let t = 0; t < idx.length; t += 3) {
        const [a, c, d] = [p(idx[t]), p(idx[t + 1]), p(idx[t + 2])];
        b.volume += (a[0] * (c[1] * d[2] - c[2] * d[1]) - a[1] * (c[0] * d[2] - c[2] * d[0]) + a[2] * (c[0] * d[1] - c[1] * d[0])) / 6;
      }
      acc.set(key, b);
    } finally { m.free(); }
  }
  collection.free();
  return new Map([...acc].map(([id, b]) => [id, { ...b, volume: Math.abs(b.volume) }]));
}

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('native remesh (N3) against the IFC remesh', () => {
  beforeAll(async () => {
    runtime = await import('@ifc-lite/wasm');
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    mutations = await import('@ifc-lite/mutations');
    ({ serializeEntitySubgraph } = await import('@ifc-lite/export'));
    create = await import('../index.js');
    resolveAnchor = await import('../in-store/resolve-anchor.js');
    plan = await import('./remesh-plan.js');
  }, 60_000);

  it('rebuilds the same bodies in the same place, and names what it leaves to the IFC path', async () => {
    const bytes = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new mutations.MutablePropertyView(null, 'm');
    const editor = new mutations.StoreEditor(store, view);
    const storeyExpress = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveAnchor.resolveSpatialAnchor(store, storeyExpress, view);
    const storeyId = create.nativeIdOf(new resolveAnchor.AnchorEntityReader(store, view).entity(storeyExpress)?.attributes[0])!;
    const elements: import('./schema.js').NativeElement[] = [
      { id: id(1), kind: 'wall', storeyId, start: [0, 0], end: [6, 0], thickness: 0.3, height: 2.7, endCut: { left: 0.15, right: -0.15 } },
      { id: id(2), kind: 'opening', host: 'wall', storeyId, hostId: id(1), along: 2, sill: 0.9, width: 1.2, height: 1.4 },
      { id: id(3), kind: 'wall', storeyId, start: [0, 4], end: [4, 7], thickness: 0.25, height: 2.7, baseOffset: 0.1 },
      { id: id(4), kind: 'opening', host: 'wall', storeyId, hostId: id(3), along: 2.5, sill: 0, width: 0.9, height: 2.1 },
      { id: id(5), kind: 'slab', storeyId, outline: [[0, 0], [6, 0], [6, 4], [0, 4]], thickness: 0.25 },
      { id: id(6), kind: 'opening', host: 'slab', storeyId, hostId: id(5), center: [4, 2], width: 0.8, depth: 0.6 },
      { id: id(7), kind: 'beam', storeyId, start: [0, 2, 2.6], end: [6, 3, 2.6], section: { Type: 'I', OverallWidth: 0.2, OverallDepth: 0.4, WebThickness: 0.01, FlangeThickness: 0.02 } },
      { id: id(8), kind: 'column', storeyId, position: [3, 2, 0], height: 2.6, rotation: 0.4, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.4 } },
    ];
    const native = { schemaVersion: create.NATIVE_SCHEMA_VERSION, id: id(100), name: 'n3', storeys: [{ id: storeyId, name: '', elevation: 0 }], elements, types: [], materials: [], relations: [], properties: [] };
    const index = create.nativeIndex(native);
    const express = new Map<string, number>();
    for (const el of elements) {
      if (el.kind === 'wall') express.set(el.id, create.addWallToStore(editor, anchor, create.wallStoreParams(el, index)).wallId);
      if (el.kind === 'slab') express.set(el.id, create.addSlabToStore(editor, anchor, create.slabStoreParams(el, index)).slabId);
      if (el.kind === 'beam') express.set(el.id, create.addBeamToStore(editor, anchor, create.beamStoreParams(el, index)).beamId);
      if (el.kind === 'column') express.set(el.id, create.addColumnToStore(editor, anchor, create.columnStoreParams(el, index)).columnId);
      if (el.kind === 'opening') create.addOpeningToStore(editor, create.resolveHostAnchor(store, express.get(el.hostId)!, view), create.openingStoreParams(el, index));
    }
    // A wall with two material layers (0.2 + 0.1) on a usage centred on its axis.
    const { addMaterialToStore, addMaterialLayerSetToStore, addMaterialLayerSetUsageToStore, assignMaterialInStore } = await import('../in-store/material.js');
    const layered = create.addWallToStore(editor, anchor, { Start: [8, 0, 0], End: [8, 5, 0], Thickness: 0.3, Height: 2.7 }).wallId;
    const brick = addMaterialToStore(editor, anchor, { Name: 'Brick' }).materialId;
    const plaster = addMaterialToStore(editor, anchor, { Name: 'Plaster' }).materialId;
    const set = addMaterialLayerSetToStore(editor, anchor, { MaterialLayers: [{ Material: brick, LayerThickness: 0.2 }, { Material: plaster, LayerThickness: 0.1 }] }).layerSetId;
    const usage = addMaterialLayerSetUsageToStore(editor, anchor, { ForLayerSet: set, LayerSetDirection: 'AXIS2', DirectionSense: 'POSITIVE', OffsetFromReferenceLine: -0.15 }).usageId;
    assignMaterialInStore(editor, anchor, usage, [layered], []);
    express.set('layered', layered);
    const sampleWall = [...new resolveAnchor.AnchorEntityReader(store, view).ids('IFCWALL')].find((w) => ![...express.values()].includes(w));
    const targets = new Set([...express.values(), ...(sampleWall ? [sampleWall] : [])]);

    // The IFC remesh: the edited elements' subgraph, pre-passed and meshed (no RTC shift).
    const sub = serializeEntitySubgraph(store, view, { targets });
    const api = new runtime.IfcAPI();
    let ifc: Map<string, Body>;
    try {
      const pre = api.buildPrePassOnce(sub.bytes) as { jobs: Uint32Array; unitScale: number; voidKeys: Uint32Array; voidCounts: Uint32Array; voidValues: Uint32Array; styleIds: Uint32Array; styleColors: Uint8Array };
      const jobs: number[] = [];
      for (let i = 0; i + 2 < pre.jobs.length; i += 3) if (targets.has(pre.jobs[i])) jobs.push(pre.jobs[i], pre.jobs[i + 1], pre.jobs[i + 2]);
      ifc = bodies(api.processGeometryBatch(sub.bytes, new Uint32Array(jobs), pre.unitScale, 0, 0, 0, false,
        pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors));
      api.clearPrePassCache();
    } finally { api.free(); }

    const p = plan.planNativeRemesh(store, view, targets);
    expect([...p.fallback.keys()].filter((k) => k !== sampleWall), JSON.stringify([...p.fallback])).toEqual([]);
    const colors = new Float32Array(p.expressIds.length * 4).fill(0.5);
    const nativeBodies = bodies(runtime.meshNativeElements(p.buffer, Uint32Array.from(p.expressIds), p.ifcTypes, colors, p.layers,
      Uint32Array.from(p.materialIds), new Float32Array(p.materialIds.length * 4).fill(0.5), 0, 0, 0, false));
    expect([...nativeBodies.keys()].filter((k) => k.startsWith(`${layered}:`)).sort(), 'the layered wall in one mesh per material')
      .toEqual([`${layered}:${brick}`, `${layered}:${plaster}`]);
    for (const [key, a] of nativeBodies) {
      const b = ifc.get(key)!;
      expect(b, `IFC mesh ${key}`).toBeDefined();
      if (!key.startsWith(`${layered}:`)) expect(a.volume, `${key} volume`).toBeCloseTo(b.volume, 3);
      for (let k = 0; k < 3; k++) {
        expect(a.min[k], `${key} min ${k}`).toBeCloseTo(b.min[k], 3);
        expect(a.max[k], `${key} max ${k}`).toBeCloseTo(b.max[k], 3);
      }
    }
    if (sampleWall) console.log(`[N3] sample wall #${sampleWall}: ${p.fallback.get(sampleWall) ?? 'meshed natively'}`);
  });
});
