/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * N6: a native model exported to IFC (with its export sets) and read back is
 * the same native model, and the file passes the IDS of what a Lapin export
 * carries (`export-ids.ts`), checked by the IDS validator the app uses.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { parseIDS, validateIDS } from '@ifc-lite/ids';
import { createDataAccessor } from '@ifc-lite/ids/bridge';
import { AnchorEntityReader, resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { resolveHostAnchor } from '../in-store/resolve-host.js';
import { addWallToStore } from '../in-store/wall.js';
import { addSlabToStore } from '../in-store/slab.js';
import { addBeamToStore } from '../in-store/beam.js';
import { addColumnToStore } from '../in-store/column.js';
import { addOpeningToStore } from '../in-store/opening.js';
import { addHostedElementInStore } from '../in-store/hosted-element.js';
import { addJoineryTypeToStore } from '../in-store/joinery-type.js';
import { assignTypeInStore } from '../in-store/element-type.js';
import { defaultWindowSpec } from '../in-store/joinery-spec.js';
import { liftNativeModel } from './lift.js';
import { nativeIdOf } from './lift-base.js';
import { nativeIndex } from './validate.js';
import { beamStoreParams, columnStoreParams, openingStoreParams, slabStoreParams, wallStoreParams } from './to-store-params.js';
import type { NativeElement, NativeModel } from './schema.js';
import { writeNativeExportSets } from './export-sets.js';
import { nativeExportIds } from './export-ids.js';
import { nativeElementQuantities } from './element-quantities.js';
import { nativeQuantities } from './export-sets.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const parse = (b: Uint8Array) => new IfcParser().parseColumnar(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { disableWorkerScan: true });

/** A model as compared: elements and types by id, lengths to the micrometre. */
function canonical(model: NativeModel): unknown {
  const round = (v: unknown): unknown => typeof v === 'number' ? Math.round(v * 1e6) / 1e6
    : Array.isArray(v) ? v.map(round)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, round(x)])) : v;
  const byId = <T extends { id: string }>(list: readonly T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  return round({ storeys: byId(model.storeys), elements: byId(model.elements), types: byId(model.types), materials: byId(model.materials) });
}

describe('native export round trip and IDS (N6)', () => {
  it('reads back as the same native model and passes the Lapin export IDS', async () => {
    const store = await parse(readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url)));
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyExpress = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyExpress, view);
    const storeyId = nativeIdOf(new AnchorEntityReader(store, view).entity(storeyExpress)?.attributes[0])!;
    const elements: NativeElement[] = [
      { id: id(1), kind: 'wall', storeyId, start: [0, 0], end: [6, 0], thickness: 0.3, height: 2.7 },
      { id: id(2), kind: 'opening', host: 'wall', storeyId, hostId: id(1), along: 2, sill: 0.9, width: 1.2, height: 1.4 },
      { id: id(3), kind: 'wall', storeyId, start: [0, 4], end: [4, 7], thickness: 0.25, height: 2.7, baseOffset: 0.1 },
      { id: id(4), kind: 'slab', storeyId, outline: [[0, 0], [6, 0], [6, 4], [0, 4]], thickness: 0.25 },
      { id: id(5), kind: 'opening', host: 'slab', storeyId, hostId: id(4), center: [4, 2], width: 0.8, depth: 0.6 },
      { id: id(6), kind: 'beam', storeyId, start: [0, 2, 2.6], end: [6, 3, 2.6], section: { Type: 'I', OverallWidth: 0.2, OverallDepth: 0.4, WebThickness: 0.01, FlangeThickness: 0.02 } },
      { id: id(7), kind: 'column', storeyId, position: [3, 2, 0], height: 2.6, rotation: 0.4, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.4 } },
    ];
    const index = nativeIndex({ elements, types: [], storeys: [{ id: storeyId, name: '', elevation: 0 }] });
    const express = new Map<string, number>();
    for (const el of elements) {
      if (el.kind === 'wall') express.set(el.id, addWallToStore(editor, anchor, wallStoreParams(el, index)).wallId);
      if (el.kind === 'slab') express.set(el.id, addSlabToStore(editor, anchor, slabStoreParams(el, index)).slabId);
      if (el.kind === 'beam') addBeamToStore(editor, anchor, beamStoreParams(el, index));
      if (el.kind === 'column') addColumnToStore(editor, anchor, columnStoreParams(el, index));
      if (el.kind === 'opening') addOpeningToStore(editor, resolveHostAnchor(store, express.get(el.hostId)!, view), openingStoreParams(el, index));
    }
    // A window of a joinery type in the second wall.
    const host = express.get(id(3))!;
    const spec = defaultWindowSpec('W-RT');
    const type = addJoineryTypeToStore(editor, resolveHostAnchor(store, host, view), spec);
    const window = addHostedElementInStore(store, editor, host, { kind: 'window', params: { Offset: 1.5, Sill: 0.9, Width: spec.width, Height: spec.height, MappedBody: type.mapId } }).expressId;
    assignTypeInStore(editor, resolveHostAnchor(store, host, view), type.typeId, [window], []);

    const before = liftNativeModel(store, view, { id: id(100), name: 'rt' });
    // The sample's own wall (and its openings) is not native; what this test wrote all is.
    expect(before.skipped.filter((k) => view.getNewEntity(k.expressId))).toEqual([]);
    expect(before.model.elements.map((e) => e.kind).sort()).toEqual(['beam', 'column', 'opening', 'opening', 'slab', 'wall', 'wall', 'window']);
    // One element's quantities, read on their own, are the whole model's for it (in the session and in the file read back).
    const sameQuantities = (store_: typeof store, view_: MutablePropertyView, lifted: typeof before) => {
      const index = nativeIndex(lifted.model);
      for (const e of lifted.model.elements) {
        const hosted = lifted.model.elements.filter((h) => 'hostId' in h && h.hostId === e.id);
        const whole = nativeQuantities(e, index, hosted);
        const one = nativeElementQuantities(store_, view_, lifted.expressIds.get(e.id)!);
        expect(one?.set, `${e.kind} set`).toBe(whole?.set);
        whole?.quantities.forEach((q, k) => expect(one!.quantities[k].value, `${e.kind} ${q.name}`).toBeCloseTo(q.value, 9));
      }
    };
    sameQuantities(store, view, before);
    writeNativeExportSets(view, before.model, before.expressIds);
    const bytes = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array;

    // Read back: the same elements, types and materials, under the same ids.
    const reparsed = await parse(bytes);
    const afterView = new MutablePropertyView(null, 'r');
    const after = liftNativeModel(reparsed, afterView, { id: id(100), name: 'rt' });
    expect(after.skipped.length).toBe(before.skipped.length);
    expect(canonical(after.model)).toEqual(canonical(before.model));
    sameQuantities(reparsed, afterView, after);

    // The IDS of a Lapin export: every native element it applies to passes.
    const document = parseIDS(nativeExportIds());
    const report = await validateIDS(document, createDataAccessor(reparsed), { modelId: 'rt', schemaVersion: 'IFC4', entityCount: reparsed.entityCount });
    const failures = report.specificationResults.flatMap((s) => s.entityResults.filter((e) => !e.passed)
      .map((e) => `${s.specification.name} #${e.expressId}: ${e.requirementResults.filter((r) => r.status === 'fail').map((r) => r.checkedDescription).join('; ')}`));
    expect(failures).toEqual([]);
    const applicable = Object.fromEntries(report.specificationResults.map((s) => [s.specification.name, s.applicableCount]));
    expect(applicable).toMatchObject({ 'Lapin native wall': 2, 'Lapin native slab': 1, 'Lapin native beam': 1, 'Lapin native column': 1, 'Lapin native opening': 2, 'Lapin native window': 1 });

    // And it catches an export that lost them: one wall's base quantities left out fails it, for that wall only.
    const lossy = view.detachedCopy();
    lossy.deleteQuantitySet(express.get(id(1))!, 'Qto_WallBaseQuantities');
    const short = await parse(new StepExporter(store, lossy).export({ schema: 'IFC4', applyMutations: true }).content as Uint8Array);
    const shortReport = await validateIDS(document, createDataAccessor(short), { modelId: 'short', schemaVersion: 'IFC4', entityCount: short.entityCount });
    expect(shortReport.specificationResults.map((s) => [s.specification.name, s.failedCount]).filter(([, n]) => n)).toEqual([['Lapin native wall', 1]]);
  });
});
