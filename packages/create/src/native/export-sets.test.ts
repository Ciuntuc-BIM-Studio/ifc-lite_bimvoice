/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** N6: an exported native model carries its base quantities and Pset_LapinNative, read back from the STEP. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser, extractPropertiesOnDemand, extractQuantitiesOnDemand } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { AnchorEntityReader, resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { resolveHostAnchor } from '../in-store/resolve-host.js';
import { addWallToStore } from '../in-store/wall.js';
import { addSlabToStore } from '../in-store/slab.js';
import { addBeamToStore } from '../in-store/beam.js';
import { addOpeningToStore } from '../in-store/opening.js';
import { liftNativeModel } from './lift.js';
import { setElementSizeInStore } from '../in-store/element-size-edit.js';
import { nativeIdOf } from './lift-base.js';
import { nativeIndex } from './validate.js';
import { beamStoreParams, openingStoreParams, slabStoreParams, wallStoreParams } from './to-store-params.js';
import { NATIVE_SCHEMA_VERSION, type NativeBeam, type NativeElement, type NativeSlab, type NativeWall, type NativeWallOpening } from './schema.js';
import { sectionArea, writeNativeExportSets } from './export-sets.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('native export sets (N6)', () => {
  it('a section area has its closed form', () => {
    expect(sectionArea({ Type: 'Rectangle', XDim: 0.2, YDim: 0.4 })).toBeCloseTo(0.08, 12);
    expect(sectionArea({ Type: 'I', OverallWidth: 0.2, OverallDepth: 0.4, WebThickness: 0.01, FlangeThickness: 0.02 })).toBeCloseTo(2 * 0.2 * 0.02 + 0.36 * 0.01, 12);
  });

  it('writes the base quantities (net of openings) and the native parameters, and they export', async () => {
    const bytes = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const parse = (b: Uint8Array) => new IfcParser().parseColumnar(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const store = await parse(bytes);
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyExpress = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyExpress, view);
    const storeyId = nativeIdOf(new AnchorEntityReader(store, view).entity(storeyExpress)?.attributes[0])!;
    const wallEl: NativeWall = { id: id(1), kind: 'wall', storeyId, start: [0, 0], end: [6, 0], thickness: 0.3, height: 2.7 };
    const openingEl: NativeWallOpening = { id: id(2), kind: 'opening', host: 'wall', storeyId, hostId: id(1), along: 2, sill: 0.9, width: 1.2, height: 1.4 };
    const slabEl: NativeSlab = { id: id(3), kind: 'slab', storeyId, outline: [[0, 0], [6, 0], [6, 4], [0, 4]], thickness: 0.25 };
    const beamEl: NativeBeam = { id: id(4), kind: 'beam', storeyId, start: [0, 2, 2.6], end: [6, 2, 2.6], section: { Type: 'Rectangle', XDim: 0.2, YDim: 0.4 } };
    const elements: NativeElement[] = [wallEl, openingEl, slabEl, beamEl];
    const index = nativeIndex({ elements, types: [], storeys: [{ id: storeyId, name: '', elevation: 0 }] });
    const wall = addWallToStore(editor, anchor, wallStoreParams(wallEl, index)).wallId;
    addOpeningToStore(editor, resolveHostAnchor(store, wall, view), openingStoreParams(openingEl, index));
    addSlabToStore(editor, anchor, slabStoreParams(slabEl, index));
    addBeamToStore(editor, anchor, beamStoreParams(beamEl, index));

    const lifted = liftNativeModel(store, view, { id: id(100), name: 'n6' });
    const sets = writeNativeExportSets(view, lifted.model, lifted.expressIds);
    expect(sets.quantitySets).toBeGreaterThanOrEqual(4);

    const out = new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content;
    const text = new TextDecoder().decode(out);
    const reparsed = await parse(out);
    expect(text).toContain("'Qto_WallBaseQuantities'");
    expect(text).toContain("'Pset_LapinNative'");
    // The wall's net volume: 6 x 2.7 x 0.3 less the 1.2 x 1.4 opening through it.
    const net = (6 * 2.7 - 1.2 * 1.4) * 0.3;
    expect(text).toMatch(new RegExp(`IFCQUANTITYVOLUME\\('NetVolume',\\$,\\$,${net.toFixed(3).replace('.', '\\.')}`));
    expect(text).toMatch(/IFCQUANTITYAREA\('GrossArea',\$,\$,24\.?/);
    expect(text).toMatch(/IFCQUANTITYAREA\('CrossSectionArea',\$,\$,0\.08/);
    // The parameters read back as the element's.
    const params = text.match(/IFCPROPERTYSINGLEVALUE\('Parameters',\$,IFCTEXT\('(\{[^']*"start"[^']*)'\)/);
    expect(params, 'the wall parameters').not.toBeNull();
    expect(JSON.parse(params![1])).toMatchObject({ start: [0, 0], end: [6, 0], thickness: 0.3, height: 2.7 });
    expect(text).toMatch(new RegExp(`IFCPROPERTYSINGLEVALUE\\('SchemaVersion',\\$,IFCINTEGER\\(${NATIVE_SCHEMA_VERSION}\\)`));
    expect(reparsed.entityCount).toBeGreaterThan(store.entityCount);

    // Exported again after an edit: its own sets are replaced (one of each), the quantities follow it.
    const view2 = new MutablePropertyView(null, 'm2');
    view2.setOnDemandExtractor((entityId) => extractPropertiesOnDemand(reparsed, entityId));
    view2.setQuantityExtractor((entityId) => extractQuantitiesOnDemand(reparsed, entityId));
    const editor2 = new StoreEditor(reparsed, view2);
    const sized = setElementSizeInStore({ dataStore: reparsed, view: view2, editor: editor2 }, wall, { kind: 'wall', height: 3 });
    expect(sized.ok).toBe(true);
    const again = liftNativeModel(reparsed, view2, { id: id(100), name: 'n6' });
    writeNativeExportSets(view2, again.model, again.expressIds);
    const text2 = new TextDecoder().decode(new StepExporter(reparsed, view2).export({ schema: 'IFC4', applyMutations: true }).content);
    const count = (pattern: RegExp) => (text2.match(pattern) ?? []).length;
    expect(count(/IFCELEMENTQUANTITY\('[^']*',[^,]*,'Qto_WallBaseQuantities'/g), 'one wall quantity set').toBe(1);
    expect(count(/IFCPROPERTYSET\('[^']*',[^,]*,'Pset_LapinNative'/g), 'one native set per element').toBe(sets.propertySets);
    const net2 = (6 * 3 - 1.2 * 1.4) * 0.3;
    expect(text2).toMatch(new RegExp(`IFCQUANTITYVOLUME\\('NetVolume',\\$,\\$,${net2.toFixed(3).replace('.', '\\.')}`));
  });
});
