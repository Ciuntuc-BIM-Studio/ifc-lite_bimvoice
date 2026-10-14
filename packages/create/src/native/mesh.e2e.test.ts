/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * N2: a native element meshed from its parameters (`meshNativeSolids`) has
 * the body the IFC path meshes for the same element written by the IFC
 * writers — same volume, same extents — and skips the STEP round trip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IfcDataStore } from '@ifc-lite/parser';

const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));

type Runtime = typeof import('@ifc-lite/wasm');
let runtime: Runtime;
let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let mutations: typeof import('@ifc-lite/mutations');
let StepExporter: typeof import('@ifc-lite/export').StepExporter;
let serializeEntitySubgraph: typeof import('@ifc-lite/export').serializeEntitySubgraph;
let create: typeof import('../index.js');

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });

interface Body { volume: number; extents: number[] }

function body(positions: ArrayLike<number>, indices: ArrayLike<number>, origin = [0, 0, 0]): Body {
  const p = (i: number) => [0, 1, 2].map((a) => origin[a] + positions[i * 3 + a]);
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [p(indices[t]), p(indices[t + 1]), p(indices[t + 2])];
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  const extents = [0, 1, 2].map((a) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i < positions.length; i += 3) { lo = Math.min(lo, positions[i]); hi = Math.max(hi, positions[i]); }
    return hi - lo;
  });
  return { volume: Math.abs(volume), extents: extents.sort((x, y) => x - y) };
}

/** The IFC path's body of `id` in exported `bytes`, all of its meshes together. */
function ifcBody(bytes: Uint8Array, store: IfcDataStore, id: number): Body {
  const api = new runtime.IfcAPI();
  try {
    const ref = store.entityIndex.byId.get(id)!;
    const pre = api.buildPrePassOnce(bytes);
    const c = api.processGeometryBatch(bytes, new Uint32Array([id, ref.byteOffset, ref.byteOffset + ref.byteLength]), pre.unitScale, 0, 0, 0, false,
      pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
    const positions: number[] = [], indices: number[] = [];
    try {
      for (let i = 0; i < c.length; i++) {
        const m = c.takeMesh(i);
        if (!m) continue;
        try {
          const base = positions.length / 3;
          for (let j = 0; j < m.positions.length; j++) positions.push(m.origin[j % 3] + m.positions[j]);
          for (const k of m.indices) indices.push(base + k);
        } finally { m.free(); }
      }
    } finally { c.free(); }
    return body(positions, indices);
  } finally {
    try { api.clearPrePassCache(); } finally { api.free(); }
  }
}

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('native meshing (N2) against the IFC path', () => {
  beforeAll(async () => {
    runtime = await import('@ifc-lite/wasm');
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    mutations = await import('@ifc-lite/mutations');
    ({ StepExporter, serializeEntitySubgraph } = await import('@ifc-lite/export'));
    create = await import('../index.js');
  }, 60_000);

  it('builds the body the IFC writers and mesher build, without STEP', async () => {
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new mutations.MutablePropertyView(null, 'm');
    const editor = new mutations.StoreEditor(store, view);
    const storeyExpress = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = create.resolveSpatialAnchor(store, storeyExpress, view);
    const { AnchorEntityReader } = await import('../in-store/resolve-anchor.js');
    const storeyId = create.nativeIdOf(new AnchorEntityReader(store, view).entity(storeyExpress)?.attributes[0])!;
    const elements: import('./schema.js').NativeElement[] = [
      { id: id(1), kind: 'wall', storeyId, start: [0, 0], end: [6, 0], thickness: 0.3, height: 2.7, endCut: { left: 0.15, right: -0.15 } },
      { id: id(2), kind: 'opening', host: 'wall', storeyId, hostId: id(1), along: 2, sill: 0.9, width: 1.2, height: 1.4 },
      { id: id(3), kind: 'slab', storeyId, outline: [[0, 0], [6, 0], [6, 4], [0, 4]], thickness: 0.25 },
      { id: id(4), kind: 'beam', storeyId, start: [0, 2, 2.6], end: [6, 2, 2.6], section: { Type: 'I', OverallWidth: 0.2, OverallDepth: 0.4, WebThickness: 0.01, FlangeThickness: 0.02 } },
      { id: id(6), kind: 'wall', storeyId, start: [0, 4], end: [4, 7], thickness: 0.25, height: 2.7 },
      { id: id(7), kind: 'opening', host: 'wall', storeyId, hostId: id(6), along: 2.5, sill: 0, width: 0.9, height: 2.1 },
      { id: id(5), kind: 'column', storeyId, position: [3, 2, 0], height: 2.6, rotation: 0.4, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.4 } },
    ];
    const native = { schemaVersion: create.NATIVE_SCHEMA_VERSION, id: id(100), name: 'n2', storeys: [{ id: storeyId, name: '', elevation: 0 }], elements, types: [], materials: [], relations: [], properties: [] };
    const index = create.nativeIndex(native);
    const express = new Map<string, number>();
    for (const el of elements) {
      if (el.kind === 'wall') express.set(el.id, create.addWallToStore(editor, anchor, create.wallStoreParams(el, index)).wallId);
      if (el.kind === 'slab') express.set(el.id, create.addSlabToStore(editor, anchor, create.slabStoreParams(el, index)).slabId);
      if (el.kind === 'beam') express.set(el.id, create.addBeamToStore(editor, anchor, create.beamStoreParams(el, index)).beamId);
      if (el.kind === 'column') express.set(el.id, create.addColumnToStore(editor, anchor, create.columnStoreParams(el, index)).columnId);
      if (el.kind === 'opening') create.addOpeningToStore(editor, create.resolveHostAnchor(store, express.get(el.hostId)!, view), create.openingStoreParams(el, index));
    }
    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array;
    const reparsed = await parse(bytes);

    const solids = create.nativeModelSolids(elements, index);
    const order = [...solids.keys()];
    const meshes = runtime.meshNativeSolids(create.encodeNativeSolids(order.flatMap((k) => solids.get(k)!)));
    for (const [i, key] of order.entries()) {
      const mesh = meshes[i] as { positions: Float32Array; indices: Uint32Array; error?: string };
      expect(mesh.error, key).toBeUndefined();
      const nativeBody = body(mesh.positions, mesh.indices);
      const ifc = ifcBody(bytes, reparsed, express.get(key)!);
      expect(nativeBody.volume, `${key} volume`).toBeCloseTo(ifc.volume, 3);
      for (let a = 0; a < 3; a++) expect(nativeBody.extents[a], `${key} extent ${a}`).toBeCloseTo(ifc.extents[a], 3);
    }

    // What an edit costs on each path: the IFC remesh (STEP text of the
    // edited elements, pre-pass, mesh) against the native mesh. Reported, not
    // asserted (machine-dependent).
    const targets = new Set([...express.values()]);
    const runs = 20;
    const ifcRemesh = () => {
      const sub = serializeEntitySubgraph(store, view, { targets });
      const text = new TextDecoder().decode(sub.bytes);
      const jobs: number[] = [];
      for (const target of targets) {
        const start = text.indexOf(`#${target}=`);
        jobs.push(target, start, text.indexOf(';', start) + 1);
      }
      const api = new runtime.IfcAPI();
      try {
        const pre = api.buildPrePassOnce(sub.bytes);
        const c = api.processGeometryBatch(sub.bytes, new Uint32Array(jobs), pre.unitScale, 0, 0, 0, false,
          pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
        const n = c.length;
        for (let i = 0; i < n; i++) c.takeMesh(i)?.free();
        c.free();
        api.clearPrePassCache();
        return n;
      } finally { api.free(); }
    };
    expect(ifcRemesh()).toBeGreaterThan(0);
    let t = performance.now();
    for (let r = 0; r < runs; r++) ifcRemesh();
    const stepMs = (performance.now() - t) / runs;
    t = performance.now();
    for (let r = 0; r < runs; r++) runtime.meshNativeSolids(create.encodeNativeSolids(order.flatMap((k) => create.nativeModelSolids(elements, index).get(k)!)));
    const nativeMs = (performance.now() - t) / runs;
    for (const key of order) {
      const buf = create.encodeNativeSolids(solids.get(key)!);
      const t0 = performance.now();
      for (let r = 0; r < runs; r++) runtime.meshNativeSolids(buf);
      console.log(`[N2] ${elements.find((e) => e.id === key)!.kind}: ${((performance.now() - t0) / runs).toFixed(3)} ms`);
    }
    console.log(`[N2] remesh of ${targets.size} elements: IFC path (STEP + pre-pass + mesh) ${stepMs.toFixed(2)} ms, native ${nativeMs.toFixed(2)} ms`);
    // Without the mitred wall (its opening takes the exact kernel natively).
    const plain = new Set([...targets].filter((t) => t !== express.get(id(1))));
    const plainKeys = order.filter((k) => k !== id(1));
    const plainIfc = () => { const saved = new Set(targets); targets.clear(); for (const p of plain) targets.add(p); try { return ifcRemesh(); } finally { targets.clear(); for (const p of saved) targets.add(p); } };
    t = performance.now();
    for (let r = 0; r < runs; r++) plainIfc();
    const plainStep = (performance.now() - t) / runs;
    t = performance.now();
    for (let r = 0; r < runs; r++) runtime.meshNativeSolids(create.encodeNativeSolids(plainKeys.flatMap((k) => create.nativeModelSolids(elements, index).get(k)!)));
    console.log(`[N2] same without the mitred wall (${plain.size}): IFC ${plainStep.toFixed(2)} ms, native ${((performance.now() - t) / runs).toFixed(3)} ms`);
  });
});
