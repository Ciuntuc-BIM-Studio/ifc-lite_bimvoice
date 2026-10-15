/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * N8: what a large native model costs, phase by phase — authoring it, saving
 * (STEP), opening (parse), reading it native (lift), validating, one edit's
 * re-mesh and the whole model's mesh — each natively and through the IFC
 * path — and the export sets. A grid of rooms
 * on several storeys: per room two walls with an opening each, a slab, a
 * column and a beam (7 elements). `LAPIN_SCALE` sets the element count (by
 * default 7 000; the plan's benchmark runs 100 000). The budgets are per
 * element and generous (a slow CI machine), there to catch a phase going
 * quadratic, not to time it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { NativeElement } from './schema.js';

const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));
const COUNT = Number(process.env.LAPIN_SCALE ?? 7000);
const STOREYS = Math.max(1, Math.round(COUNT / 10_000)) * 2;

let runtime: typeof import('@ifc-lite/wasm');
let IfcParser: typeof import('@ifc-lite/parser').IfcParser;
let mutations: typeof import('@ifc-lite/mutations');
let StepExporter: typeof import('@ifc-lite/export').StepExporter;
let serializeEntitySubgraph: typeof import('@ifc-lite/export').serializeEntitySubgraph;
let create: typeof import('../index.js');
let anchors: typeof import('../in-store/resolve-anchor.js');
let storeys: typeof import('../in-store/storey.js');
let plan: typeof import('./remesh-plan.js');

const parse = (bytes: Uint8Array): Promise<IfcDataStore> => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** Milliseconds `fn` takes, and what it returns. */
function timed<T>(fn: () => T): [T, number] {
  const t = performance.now();
  const out = fn();
  return [out, performance.now() - t];
}

/** One room's elements at grid cell (i, j), on `storeyId`. */
function room(n: number, storeyId: string, i: number, j: number): NativeElement[] {
  const [x, y] = [i * 6, j * 5];
  return [
    { id: uuid(n), kind: 'wall', storeyId, start: [x, y], end: [x + 6, y], thickness: 0.25, height: 2.8 },
    { id: uuid(n + 1), kind: 'opening', host: 'wall', storeyId, hostId: uuid(n), along: 2, sill: 0.9, width: 1.2, height: 1.4 },
    { id: uuid(n + 2), kind: 'wall', storeyId, start: [x, y], end: [x, y + 5], thickness: 0.2, height: 2.8 },
    { id: uuid(n + 3), kind: 'opening', host: 'wall', storeyId, hostId: uuid(n + 2), along: 2, sill: 0, width: 0.9, height: 2.1 },
    { id: uuid(n + 4), kind: 'slab', storeyId, outline: [[x, y], [x + 6, y], [x + 6, y + 5], [x, y + 5]], thickness: 0.2, baseOffset: 2.8 },
    { id: uuid(n + 5), kind: 'column', storeyId, position: [x + 3, y + 2.5, 0], height: 2.6, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.3 } },
    { id: uuid(n + 6), kind: 'beam', storeyId, start: [x, y + 2.5, 2.6], end: [x + 6, y + 2.5, 2.6], section: { Type: 'Rectangle', XDim: 0.2, YDim: 0.3 } },
  ];
}

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))(`a native model of ${COUNT} elements (N8)`, () => {
  beforeAll(async () => {
    runtime = await import('@ifc-lite/wasm');
    runtime.initSync({ module: readFileSync(WASM) });
    ({ IfcParser } = await import('@ifc-lite/parser'));
    mutations = await import('@ifc-lite/mutations');
    ({ StepExporter, serializeEntitySubgraph } = await import('@ifc-lite/export'));
    create = await import('../index.js');
    anchors = await import('../in-store/resolve-anchor.js');
    storeys = await import('../in-store/storey.js');
    plan = await import('./remesh-plan.js');
  }, 60_000);

  it('authors, saves, opens, lifts, edits, meshes and exports within budget', async () => {
    const report: Array<[string, number]> = [];
    const note = (phase: string, ms: number) => { report.push([phase, ms]); console.log(`[N8] … ${phase} ${ms.toFixed(0)} ms`); };
    const source = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await parse(source);
    const view = new mutations.MutablePropertyView(null, 'm');
    const editor = new mutations.StoreEditor(store, view);
    const reference = anchors.resolveSpatialAnchor(store, [...store.spatialHierarchy!.storeyElevations.keys()][0], view);

    // Authoring: the rooms written through the same writers the tools use.
    const rooms = Math.ceil(COUNT / 7 / STOREYS);
    const side = Math.ceil(Math.sqrt(rooms));
    let elements = 0;
    const [, authorMs] = timed(() => {
      for (let s = 0; s < STOREYS; s++) {
        const storey = storeys.addStoreyToStore(store, editor, reference, { Name: `L${s}`, Elevation: 10 + s * 3 });
        const anchor = anchors.resolveSpatialAnchor(store, storey.storeyId, view);
        const storeyId = create.nativeIdOf(storey.globalId)!;
        const list = Array.from({ length: rooms }, (_, r) => room(1 + (s * rooms + r) * 7, storeyId, r % side, Math.floor(r / side))).flat();
        const index = create.nativeIndex({ schemaVersion: create.NATIVE_SCHEMA_VERSION, id: uuid(0), name: '', storeys: [{ id: storeyId, name: '', elevation: 0 }], elements: list, types: [], materials: [], relations: [], properties: [] });
        const express = new Map<string, number>();
        for (const el of list) {
          if (el.kind === 'wall') express.set(el.id, create.addWallToStore(editor, anchor, create.wallStoreParams(el, index)).wallId);
          else if (el.kind === 'slab') create.addSlabToStore(editor, anchor, create.slabStoreParams(el, index));
          else if (el.kind === 'beam') create.addBeamToStore(editor, anchor, create.beamStoreParams(el, index));
          else if (el.kind === 'column') create.addColumnToStore(editor, anchor, create.columnStoreParams(el, index));
          else if (el.kind === 'opening') create.addOpeningToStore(editor, create.resolveHostAnchor(store, express.get(el.hostId)!, view), create.openingStoreParams(el, index));
          elements++;
        }
      }
    });
    note('author', authorMs);

    // Save: the whole model to STEP, edits applied. Open: parse it back.
    const [bytes, saveMs] = timed(() => new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array);
    note('save (STEP)', saveMs);
    const t = performance.now();
    const opened = await parse(bytes);
    note('open (parse)', performance.now() - t);
    const openedView = new mutations.MutablePropertyView(null, 'm');

    // Read native: the lift, then the schema's validation.
    const [lifted, liftMs] = timed(() => create.liftNativeModel(opened, openedView, { id: uuid(0), name: 'scale' }));
    note('lift', liftMs);
    expect(lifted.model.elements.length, JSON.stringify(lifted.skipped.slice(0, 3))).toBeGreaterThanOrEqual(elements);
    const [problems, validateMs] = timed(() => create.nativeModelProblems(lifted.model));
    note('validate', validateMs);
    expect([...problems].slice(0, 3)).toEqual([]);

    // One edit's re-mesh: a wall and its opening, in the full model (the context it builds must not cost the model).
    const wall = lifted.expressIds.get(uuid(1 + Math.floor(rooms / 2) * 7))!;
    const [, firstPlanMs] = timed(() => plan.planNativeRemesh(opened, openedView, new Set([wall])));
    const runs = Number(process.env.LAPIN_EDIT_RUNS ?? 10);
    const [one, planMs] = timed(() => { let p; for (let r = 0; r < runs; r++) p = plan.planNativeRemesh(opened, openedView, new Set([wall])); return p!; });
    expect(one.fallback.size).toBe(0);
    expect(Number.isNaN(one.frames[0]), 'the wall is voided by its opening (read from the relationship graph)').toBe(true);
    note('edit re-mesh plan, first', firstPlanMs); note('edit re-mesh plan', planMs / runs);
    const meshPlan = (p: import('./remesh-plan.js').NativeRemeshPlan) => {
      const c = runtime.meshNativeElements(p.buffer, Uint32Array.from(p.expressIds), p.ifcTypes, new Float32Array(p.expressIds.length * 4).fill(0.5),
        Uint32Array.from(p.itemIds), p.frames, p.layers, Uint32Array.from(p.materialIds), new Float32Array(p.materialIds.length * 4).fill(0.5), 0, 0, 0, false);
      let n = 0;
      for (let i = 0; i < c.length; i++) { const m = c.takeMesh(i); if (m) { n += m.indices.length / 3; m.free(); } }
      c.free();
      return n;
    };
    /** IFC meshing of `jobs` (express id, byte start, byte end triples) in `bytes`: pre-pass, then batches. */
    const meshIfc = (bytes: Uint8Array, keep?: (id: number) => boolean) => {
      const api = new runtime.IfcAPI();
      try {
        const pre = api.buildPrePassOnce(bytes) as { jobs: Uint32Array; unitScale: number; voidKeys: Uint32Array; voidCounts: Uint32Array; voidValues: Uint32Array; styleIds: Uint32Array; styleColors: Uint8Array };
        const jobs: number[] = [];
        for (let i = 0; i + 2 < pre.jobs.length; i += 3) if (!keep || keep(pre.jobs[i])) jobs.push(pre.jobs[i], pre.jobs[i + 1], pre.jobs[i + 2]);
        let n = 0;
        for (let k = 0; k < jobs.length; k += 6000) {
          const c = api.processGeometryBatch(bytes, new Uint32Array(jobs.slice(k, k + 6000)), pre.unitScale, 0, 0, 0, false, pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
          for (let i = 0; i < c.length; i++) { const m = c.takeMesh(i); if (m) { n += m.indices.length / 3; m.free(); } }
          c.free();
        }
        api.clearPrePassCache();
        return n;
      } finally { api.free(); }
    };
    // One edit re-meshed whole, both ways: native (plan + mesh) and IFC (the elements' STEP subgraph, pre-pass, mesh).
    const [, nativeEditMs] = timed(() => { for (let r = 0; r < runs; r++) meshPlan(plan.planNativeRemesh(opened, openedView, new Set([wall]))); });
    note('edit re-mesh (native)', nativeEditMs / runs);
    const ifcEdit = () => meshIfc(serializeEntitySubgraph(opened, openedView, { targets: new Set([wall]) }).bytes, (id) => id === wall);
    expect(ifcEdit()).toBeGreaterThan(0);
    const [, ifcEditMs] = timed(() => { for (let r = 0; r < runs; r++) ifcEdit(); });
    note('edit re-mesh (IFC)', ifcEditMs / runs);

    // The whole model meshed from the IFC, as an open without package geometry does.
    let ifcTriangles = 0;
    const [, ifcMeshMs] = timed(() => { ifcTriangles = meshIfc(bytes); });
    note('mesh all (IFC)', ifcMeshMs);

    // The whole model meshed natively, in batches as the viewer does.
    // What the viewer draws: openings only cut.
    const products = lifted.model.elements.filter((e) => e.kind !== 'opening').map((e) => lifted.expressIds.get(e.id)!);
    let triangles = 0;
    const [, meshMs] = timed(() => {
      for (let k = 0; k < products.length; k += 2000) {
        triangles += meshPlan(plan.planNativeRemesh(opened, openedView, new Set(products.slice(k, k + 2000))));
      }
    });
    note('mesh all natively', meshMs);

    // Export: the base quantities and Pset_LapinNative on a copy, then STEP.
    const exportView = openedView.detachedCopy();
    const [sets, setsMs] = timed(() => create.writeNativeExportSets(exportView, lifted.model, lifted.expressIds));
    note('export sets', setsMs);
    expect(sets.propertySets).toBe(lifted.model.elements.length);
    const [exported, exportMs] = timed(() => new StepExporter(opened, exportView).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array);
    note('export (STEP)', exportMs);

    const per = (ms: number) => (ms / elements * 1000).toFixed(1);
    console.log(`[N8] ${elements} elements on ${STOREYS} storeys, ${(bytes.byteLength / 1e6).toFixed(1)} MB saved, ${(exported.byteLength / 1e6).toFixed(1)} MB exported, ${triangles} triangles native, ${ifcTriangles} IFC`);
    for (const [phase, ms] of report) console.log(`[N8] ${phase.padEnd(26)} ${ms.toFixed(1).padStart(9)} ms  ${per(ms).padStart(7)} µs/element`);

    // Budgets: per element, for the phases that run over the whole model; absolute for the one edit.
    const budget: Record<string, number> = { author: 0.6, 'save (STEP)': 0.5, 'open (parse)': 0.3, lift: 0.5, validate: 0.02, 'mesh all natively': 1, 'mesh all (IFC)': 2, 'export sets': 0.4, 'export (STEP)': 0.5 };
    for (const [phase, ms] of report) {
      if (phase in budget) expect(ms / elements, `${phase} ms per element`).toBeLessThan(budget[phase]);
    }
    expect(planMs / runs, 'one edit\'s re-mesh plan (ms)').toBeLessThan(10);
    expect(nativeEditMs / runs, 'one edit\'s native re-mesh (ms)').toBeLessThan(20);
  }, 1_800_000);
});
