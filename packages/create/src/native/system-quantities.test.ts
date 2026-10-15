/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A system's base quantities from its family's spec, as the properties panel
 * reads them for one element (`nativeElementQuantities`): a railing's
 * length, a roof's sloped and plan areas, a curtain wall's length and face.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { addRailingToStore } from '../in-store/railing.js';
import { addRoofSystemToStore } from '../in-store/roof-system-store.js';
import { defaultRoofStructure } from '../in-store/roof-structure.js';
import { addCurtainWallSystemToStore, DEFAULT_CURTAIN_WALL_TYPE } from '../in-store/curtain-wall-system.js';
import { resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { addStairToStore } from '../in-store/stair.js';
import { addTrussToStore, trussParts } from '../in-store/truss-store.js';
import { defaultTimberTruss } from '../in-store/truss.js';
import { nativeElementQuantities } from './element-quantities.js';
import { addCorridorToStore, addTerrainToStore, readTerrainTin } from '../in-store/corridor-store.js';
import { defaultAssembly, defaultDesign } from '../civil/assembly.js';
import { buildCorridor, type CorridorSpec } from '../civil/corridor.js';
import { delaunay, Terrain, type V3 } from '../civil/tin.js';

describe('system quantities', () => {
  it('come from the family\'s spec', async () => {
    const bytes = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const anchor = resolveSpatialAnchor(store, [...store.spatialHierarchy!.storeyElevations.keys()][0], view);
    const q = (id: number) => {
      const out = nativeElementQuantities(store, view, id);
      return { set: out?.set, ...Object.fromEntries((out?.quantities ?? []).map((x) => [x.name, x.value])) };
    };

    const railing = addRailingToStore(editor, anchor, { Path: [[0, 30, 0], [3, 30, 1.8], [3, 31.2, 1.8]], Height: 0.9, PostSpacing: 0.8 }).railingId;
    expect(q(railing).set).toBe('Qto_RailingBaseQuantities');
    expect(q(railing).Length).toBeCloseTo(Math.hypot(3, 1.8) + 1.2, 6);

    const pitch = 30;
    const roof = addRoofSystemToStore(editor, anchor, {
      name: 'Roof', outline: [[20, 0], [30, 0], [30, 6], [20, 6]], eaveHeight: 3,
      rules: [{ kind: 'eave', pitch, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }, { kind: 'eave', pitch, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }],
      covering: { thickness: 0.08, color: '#a0522d' }, structure: defaultRoofStructure(), timberColor: '#c8a070',
    }).roofId;
    // Plan: the outline grown by its overhangs (10.6 x 7); sloped: that over cos(pitch).
    const r = q(roof);
    expect(r.set).toBe('Qto_RoofBaseQuantities');
    expect(r.ProjectedArea).toBeCloseTo(10.6 * 7, 6);
    expect(r.GrossArea).toBeCloseTo((10.6 * 7) / Math.cos((pitch * Math.PI) / 180), 6);

    const cw = addCurtainWallSystemToStore(editor, anchor, {
      ...DEFAULT_CURTAIN_WALL_TYPE, version: 1, name: 'CW', start: [0, 40, 0], end: [6, 40, 0], height: 3,
    }).curtainWallId;
    expect(q(cw)).toMatchObject({ set: 'Qto_CurtainWallQuantities', Length: 6, Height: 3, GrossSideArea: 18 });

    // A stair down to its base: its run, and the steps' area (T·R·n(n+1)/2) across its width.
    const stair = addStairToStore(editor, anchor, { Position: [0, 50, 0], NumberOfRisers: 4, RiserHeight: 0.18, TreadLength: 0.28, Width: 1.2 }).stairId;
    const st = q(stair);
    expect(st.set).toBe('Qto_StairBaseQuantities');
    expect(st.Length).toBeCloseTo(4 * 0.28, 9);
    expect(st.GrossVolume).toBeCloseTo(0.28 * 0.18 * 10 * 1.2, 9);
    // With a waist: less than down to its base.
    const waisted = addStairToStore(editor, anchor, { Position: [3, 50, 0], NumberOfRisers: 10, RiserHeight: 0.18, TreadLength: 0.28, Width: 1, WaistThickness: 0.15 }).stairId;
    expect(q(waisted).GrossVolume).toBeLessThan(0.28 * 0.18 * 55);

    // A truss: one member per bar its builder made.
    const truss = addTrussToStore(store, editor, anchor, { ...defaultTimberTruss(), name: 'T1', start: [0, 60, 3], end: [8, 60, 3] }).trussId;
    const tq = q(truss);
    expect(tq).toMatchObject({ set: 'Lapin_TrussQuantities', Span: 8, Rise: 2, Members: trussParts(store, truss, view).length });
    expect(tq.TimberVolume).toBeGreaterThan(0);
  });

  it('a corridor: its length, pavement and, with its terrain, cut and fill, as its builder makes them', async () => {
    const bytes = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const anchor = resolveSpatialAnchor(store, [...store.spatialHierarchy!.storeyElevations.keys()][0], view);
    const pts: V3[] = [];
    for (let x = -50; x <= 250; x += 25) for (let y = -50; y <= 250; y += 25) pts.push([x, y, 0.5 + x * 0.01]);
    const terrain = addTerrainToStore(editor, anchor, { Name: 'EG', tin: delaunay(pts) });
    const tin = readTerrainTin(store, anchor, terrain.elementId, view)!;
    const spec: CorridorSpec = {
      name: 'Road', alignment: { pis: [{ x: 0, y: 0 }, { x: 150, y: 0, radius: 60 }, { x: 150, y: 150 }] },
      profile: { pvis: [{ station: 0, elevation: 2 }, { station: 300, elevation: 3 }] }, assembly: defaultAssembly(), design: defaultDesign(), interval: 10,
      terrainGlobalId: terrain.globalId,
    };
    const corridor = addCorridorToStore(store, editor, anchor, spec, tin).corridorId;
    const out = nativeElementQuantities(store, view, corridor);
    const q = Object.fromEntries((out?.quantities ?? []).map((x) => [x.name, x.value]));
    expect(out?.set).toBe('Lapin_CorridorQuantities');
    const model = buildCorridor(spec, new Terrain(tin));
    expect(q.Length).toBeCloseTo(model.alignment.length, 6);
    // Two lanes of 3.5 and two shoulders of 1: 9 m across (a curve widens and narrows it a little).
    expect(q.PavementArea / q.Length).toBeGreaterThan(8.5);
    expect(q.PavementArea / q.Length).toBeLessThan(9.5);
    // The courses (0.6 m in all) under it.
    expect(q.PavementVolume / q.PavementArea).toBeGreaterThan(0.5);
    expect(q.PavementVolume / q.PavementArea).toBeLessThan(0.7);
    expect(q.CutVolume).toBeCloseTo(model.volumes.cut, 6);
    expect(q.FillVolume).toBeCloseTo(model.volumes.fill, 6);
    expect(q.CutVolume + q.FillVolume).toBeGreaterThan(0);
  });
});
