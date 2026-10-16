/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcAPI, initSync } from '@ifc-lite/wasm';
import { exportText, newStorey, parse } from './wall-join-mesh.oracle.js';
import { DEFAULT_PAD_FOOTING, DEFAULT_STRIP_FOUNDATION, padFootingQuantities, stemSection, stripFoundationQuantities, type PadFootingSpec, type StripFoundationSpec } from './foundation-spec.js';
import { addStripFoundationToStore, readStripFoundation, regenerateStripFoundationInStore, stripFoundationOf } from './strip-foundation.js';
import { addPadFootingToStore, readPadFooting, regeneratePadFootingInStore } from './pad-footing.js';
import { joinWallsInStore } from './wall-join-edit.js';
import { liftNativeModel } from '../native/lift.js';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { extractPropertiesOnDemand } from '@ifc-lite/parser';

const WASM = new URL('../../../wasm/pkg/ifc-lite_bg.wasm', import.meta.url);
type Box = { min: number[]; max: number[] };

const strip = (start: [number, number], end: [number, number], extra: Partial<StripFoundationSpec> = {}): StripFoundationSpec => ({
  typeId: 'sf-1', name: 'SF 30', ...DEFAULT_STRIP_FOUNDATION, start: [start[0], start[1], 0], end: [end[0], end[1], 0], ...extra,
});
const pad = (extra: Partial<PadFootingSpec> = {}): PadFootingSpec => ({ typeId: 'pf-1', name: 'PF 180', ...DEFAULT_PAD_FOOTING, position: [2, 3, 0], rotation: 0, ...extra });

/** Each element's mesh bounds in IFC axes (x, y, z up), by express id. */
function bounds(text: string): Map<number, Box> {
  initSync({ module: readFileSync(WASM) });
  const api = new IfcAPI();
  const bytes = new TextEncoder().encode(text);
  const pre = api.buildPrePassOnce(bytes);
  const out = new Map<number, Box>();
  const collection = api.processGeometryBatch(bytes, pre.jobs, pre.unitScale, 0, 0, 0, false, pre.voidKeys, pre.voidCounts, pre.voidValues, pre.styleIds, pre.styleColors);
  for (let i = 0; i < collection.length; i++) {
    const m = collection.get(i);
    if (!m) continue;
    const [ox, oy, oz] = Array.from(m.origin);
    const b = out.get(m.expressId) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let k = 0; k < m.positions.length; k += 3) {
      // WebGL Y-up back to IFC Z-up.
      const p = [m.positions[k] + ox, -(m.positions[k + 2] + oz), m.positions[k + 1] + oy];
      for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], p[a]); b.max[a] = Math.max(b.max[a], p[a]); }
    }
    out.set(m.expressId, b);
    m.free();
  }
  collection.free();
  api.clearPrePassCache();
  return out;
}

const near = (box: Box | undefined, min: number[], max: number[]) => {
  expect(box).toBeDefined();
  min.forEach((v, i) => expect(box!.min[i]).toBeCloseTo(v, 4));
  max.forEach((v, i) => expect(box!.max[i]).toBeCloseTo(v, 4));
};

describe('foundations', () => {
  it('a stem section keeps its core on the axis', () => {
    // Layers from the right face: 0.02 + 0.1 + 0.005, then the 0.3 core.
    const s = stemSection(DEFAULT_STRIP_FOUNDATION.layers);
    expect(s.thickness).toBeCloseTo(0.425, 9);
    expect(s.layerOffset).toBeCloseTo(-0.275, 9);
    expect(s.bodyOffset).toBeCloseTo(0.2125 - 0.275, 9);
  });

  it('measures a strip foundation and a stepped pad', () => {
    const q = stripFoundationQuantities(strip([0, 0], [5, 0]));
    expect(q.footingVolume).toBeCloseTo(5 * 0.6 * 0.4, 9);
    expect(q.coreVolume).toBeCloseTo(5 * 0.3 * 1.4, 9);
    const p = padFootingQuantities(DEFAULT_PAD_FOOTING);
    expect(p.volume).toBeCloseTo(1.8 * 1.8 * 0.5 + 1 * 1 * 0.4, 9);
    expect(p.height).toBeCloseTo(0.9, 9);
    expect(p.outerSurface).toBeCloseTo(4 * 1.8 * 0.5 + 4 * 1 * 0.4 + (1.8 * 1.8 - 1) + 1, 9);
  });

  it('writes a strip foundation: an assembly of a layered foundation wall on a strip footing, typed, in concrete', async () => {
    const s = await newStorey('IFC4X3');
    const made = addStripFoundationToStore(s.store, s.editor, s.anchor, strip([0, 0], [5, 0]));
    expect(readStripFoundation(s.store, made.foundationId, s.view)?.name).toBe('SF 30');
    expect(stripFoundationOf(s.store, made.stemId, s.view)).toBe(made.foundationId);
    expect(stripFoundationOf(s.store, made.footingId, s.view)).toBe(made.foundationId);
    const text = exportText(s);
    expect(text).toMatch(/IFCELEMENTASSEMBLY\('[^']+',[^,]*,'SF 30',\$,'Strip foundation'/);
    expect(text).toMatch(/IFCFOOTING\([^;]*'footing',\.STRIP_FOOTING\.\)/);
    expect(text).toMatch(/IFCWALLTYPE\([^;]*'SF 30 \(wall\)'/);
    expect(text).toMatch(/IFCFOOTINGTYPE\([^;]*'SF 30 \(footing\)'/);
    expect(text).toMatch(/IFCMATERIALLAYERSETUSAGE\([^;]*\.AXIS2\.,\.POSITIVE\.,-0\.275/);
    expect(text).toMatch(/IFCMATERIAL\('Reinforced concrete'/);
    expect(text).toContain("'Pset_LapinStripFoundation'");
  });

  it.skipIf(!existsSync(WASM))('meshes the stem with its core on the axis and the footing centred under it', async () => {
    const s = await newStorey('IFC4X3');
    const made = addStripFoundationToStore(s.store, s.editor, s.anchor, strip([0, 0], [5, 0]));
    const b = bounds(exportText(s));
    // Drawn along +X: the right face is -Y. The stem stands on the footing (bottom -1.8 + 0.4).
    near(b.get(made.stemId), [0, -0.275, -1.4], [5, 0.15, 0]);
    near(b.get(made.footingId), [0, -0.3, -1.8], [5, 0.3, -1.4]);
  });

  it.skipIf(!existsSync(WASM))('regenerates a strip foundation in place, its joins kept', async () => {
    const s = await newStorey('IFC4X3');
    const a = addStripFoundationToStore(s.store, s.editor, s.anchor, strip([0, 0], [5, 0], { extendEnd: true }));
    const c = addStripFoundationToStore(s.store, s.editor, s.anchor, strip([5, 0], [5, 4], { extendStart: true }));
    joinWallsInStore(s.editor, s.store, s.joinAnchor, a.stemId, c.stemId);
    const wider = { ...DEFAULT_STRIP_FOUNDATION, footingWidth: 0.8, stemHeight: 1.2, layers: DEFAULT_STRIP_FOUNDATION.layers.map((l) => (l.core ? { ...l, thickness: 0.4 } : l)) };
    const out = regenerateStripFoundationInStore(s.store, s.editor, s.anchor, a.foundationId, { ...strip([0, 0], [5, 0], { extendEnd: true }), ...wider });
    expect(out.stemId).toBe(a.stemId);
    expect(out.remesh).toContain(c.stemId);
    const text = exportText(s);
    expect(text.match(/IFCRELCONNECTSPATHELEMENTS\(/g)?.length).toBe(1);
    const b = bounds(text);
    // The footing ran on past the corner by half its (new) width; the stem is 1.2 tall on it.
    near(b.get(a.footingId), [0, -0.4, -1.8], [5.4, 0.4, -1.4]);
    expect(b.get(a.stemId)!.min[1]).toBeCloseTo(-0.325, 4);
    expect(b.get(a.stemId)!.max[2]).toBeCloseTo(-0.2, 4);
  });

  it.skipIf(!existsSync(WASM))('writes and regenerates a stepped pad footing where it stands', async () => {
    const s = await newStorey('IFC4X3');
    const made = addPadFootingToStore(s.store, s.editor, s.anchor, pad());
    expect(readPadFooting(s.store, made.footingId, s.view)?.steps).toHaveLength(2);
    let text = exportText(s);
    expect(text).toMatch(/IFCFOOTING\([^;]*\.PAD_FOOTING\.\)/);
    near(bounds(text).get(made.footingId), [1.1, 2.1, -1.8], [2.9, 3.9, -0.9]);

    const steps = [{ length: 2.4, width: 1.6, height: 0.4 }, { length: 1.6, width: 1.2, height: 0.3 }, { length: 0.8, width: 0.8, height: 0.3 }];
    const again = regeneratePadFootingInStore(s.store, s.editor, s.anchor, made.footingId, pad({ steps, rotation: 1 }));
    expect(again.globalId).toBe(made.globalId);
    text = exportText(s);
    // Where it stood, unturned (the kept place wins over the input's), three steps up to -0.8.
    near(bounds(text).get(made.footingId), [0.8, 2.2, -1.8], [3.2, 3.8, -0.8]);
  });

  it('lifts as native systems: the stem and the footing are the strip foundation\'s parts', async () => {
    const s = await newStorey('IFC4X3');
    const made = addStripFoundationToStore(s.store, s.editor, s.anchor, strip([0, 0], [5, 0]));
    const p = addPadFootingToStore(s.store, s.editor, s.anchor, pad());
    const store = await parse(exportText(s));
    const view = new MutablePropertyView(null, 'm');
    view.setOnDemandExtractor((id: number) => extractPropertiesOnDemand(store, id));
    const lifted = liftNativeModel(store, view, { id: '00000000-0000-4000-8000-000000000100', name: 'f' });
    const families = lifted.model.elements.filter((e) => e.kind === 'system').map((e) => (e as { family: string }).family).sort();
    expect(families).toEqual(['padFooting', 'stripFoundation']);
    expect(lifted.model.elements.some((e) => e.kind === 'wall')).toBe(false);
    void made; void p;
  });
});
