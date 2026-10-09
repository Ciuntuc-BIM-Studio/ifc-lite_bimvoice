/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cut priorities: a column through a wall cuts it (IfcRelInterferesElements,
 * ImpliedOrder TRUE, the wall relating) and the real WASM mesher subtracts
 * the column from the wall; an element out of reach, or of equal priority,
 * is not cut, and a cut that no longer applies goes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { PropertyValueType } from '@ifc-lite/data';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcAPI } from '@ifc-lite/wasm';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addWallToStore } from './wall.js';
import { addColumnToStore } from './column.js';
import { CUT_PRIORITY_PROP, CUT_PRIORITY_PSET, cutPriorityOf, syncCutsInStore } from './cut-priority.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);
const WASM = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url));
const GLUE = fileURLToPath(new URL('../../../wasm/pkg/ifc-lite.js', import.meta.url));

const parse = (bytes: Uint8Array) => new IfcParser().parseColumnar(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  { disableWorkerScan: true },
);

async function scene() {
  const store = await parse(readFileSync(SAMPLE));
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const anchor = resolveSpatialAnchor(store, 42, view);
  const wall = addWallToStore(editor, anchor, { Start: [0, 10, 0], End: [6, 10, 0], Thickness: 0.3, Height: 3 }).wallId;
  const column = addColumnToStore(editor, anchor, { Position: [3, 10, 0], Width: 0.5, Depth: 0.5, Height: 3 }).columnId;
  const apart = addColumnToStore(editor, anchor, { Position: [3, 14, 0], Width: 0.5, Depth: 0.5, Height: 3 }).columnId;
  return { store, view, editor, anchor, wall, column, apart };
}

const cuts = (view: MutablePropertyView) => view.getNewEntities().filter((e) => e.type === 'IfcRelInterferesElements');

describe('cut priorities', () => {
  it('cuts the wall by the column through it, not by the one beside it, and drops the cut at equal priority', async () => {
    const { store, view, editor, anchor, wall, column, apart } = await scene();
    expect(cutPriorityOf(store, column, view)).toBeGreaterThan(cutPriorityOf(store, wall, view)!);
    const first = syncCutsInStore(store, editor, anchor, [column, apart]);
    expect(first.added).toBe(1);
    expect(new Set(first.remesh)).toEqual(new Set([wall, column]));
    const [rel] = cuts(view);
    expect(rel.attributes[4]).toBe(`#${wall}`);
    expect(rel.attributes[5]).toBe(`#${column}`);
    // Idempotent.
    expect(syncCutsInStore(store, editor, anchor, [wall]).added).toBe(0);
    view.setProperty(column, CUT_PRIORITY_PSET, CUT_PRIORITY_PROP, 50, PropertyValueType.Integer);
    const after = syncCutsInStore(store, editor, anchor, [column]);
    expect(after.removed).toBe(1);
    expect(cuts(view)).toHaveLength(0);
  });
});

describe.skipIf(!existsSync(WASM) || !existsSync(GLUE))('cut priorities, real WASM mesh', () => {
  let RuntimeIfcAPI: typeof IfcAPI;
  let StepExporter: typeof import('@ifc-lite/export').StepExporter;
  beforeAll(async () => {
    const runtime = await import('@ifc-lite/wasm');
    RuntimeIfcAPI = runtime.IfcAPI;
    runtime.initSync({ module: readFileSync(WASM) });
    ({ StepExporter } = await import('@ifc-lite/export'));
  }, 60_000);

  /** The x of every vertex of an element's meshes (IFC Z-up), and their count. */
  function vertexXs(bytes: Uint8Array, store: IfcDataStore, id: number): number[] {
    const api = new RuntimeIfcAPI();
    try {
      const ref = store.entityIndex.byId.get(id)!;
      const pre = api.buildPrePassOnce(bytes);
      const c = api.processGeometryBatch(bytes, new Uint32Array([id, ref.byteOffset, ref.byteOffset + ref.byteLength]), pre.unitScale, 0, 0, 0, false,
        pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
      const xs: number[] = [];
      try {
        for (let i = 0; i < c.length; i++) {
          const m = c.takeMesh(i);
          if (!m) continue;
          try { for (let j = 0; j < m.positions.length; j += 3) xs.push(m.origin[0] + m.positions[j]); } finally { m.free(); }
        }
      } finally { c.free(); }
      return xs;
    } finally {
      try { api.clearPrePassCache(); } finally { api.free(); }
    }
  }

  it('meshes the wall with the column taken out of it', async () => {
    const { store, view, editor, anchor, wall, column } = await scene();
    const exportBytes = () => new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    let bytes = exportBytes();
    const near = (xs: number[], x: number) => xs.some((v) => Math.abs(v - x) < 1e-3);
    const before = vertexXs(bytes, await parse(bytes), wall);
    expect(near(before, 2.75)).toBe(false);
    syncCutsInStore(store, editor, anchor, [column]);
    bytes = exportBytes();
    expect(new TextDecoder().decode(bytes)).toMatch(/IFCRELINTERFERESELEMENTS\('[^']+',[^,]*,'IfcLite cut',\$,#\d+,#\d+,\$,'Cut',\.T\.\)/);
    const reparsed = await parse(bytes);
    const after = vertexXs(bytes, reparsed, wall);
    // The column's faces (x = 3 ± 0.25) are now the wall's.
    expect(near(after, 2.75)).toBe(true);
    expect(near(after, 3.25)).toBe(true);
    // The column itself is whole.
    const col = vertexXs(bytes, reparsed, column);
    expect(Math.min(...col)).toBeCloseTo(2.75, 3);
    expect(Math.max(...col)).toBeCloseTo(3.25, 3);
  });
});
