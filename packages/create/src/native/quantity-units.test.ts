/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Native quantities are SI; a millimetre model's file gets them in its
 * units: a 4 m wall's Qto Length is 4000 there, its areas and volumes in the
 * m² and m³ the project declares.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { addWallToStore } from '../in-store/wall.js';
import { resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { liftNativeModel } from './lift.js';
import { writeNativeExportSets } from './export-sets.js';
import { nativeElementQuantities } from './element-quantities.js';
import { quantitiesInModelUnits } from './quantity-units.js';

describe('native quantities in the model\'s units', () => {
  it('a millimetre model writes lengths in mm, areas and volumes in its declared units', async () => {
    const text = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url), 'utf8')
      .replace('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)', 'IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
    const bytes = new TextEncoder().encode(text);
    const store = await new IfcParser().parseColumnar(bytes.buffer as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const anchor = resolveSpatialAnchor(store, [...store.spatialHierarchy!.storeyElevations.keys()][0], view);
    const wall = addWallToStore(editor, anchor, { Start: [0, 20, 0], End: [4, 20, 0], Thickness: 0.2, Height: 3 }).wallId;

    // SI from the parameters...
    const si = nativeElementQuantities(store, view, wall)!;
    expect(si.quantities.find((q) => q.name === 'Length')?.value).toBeCloseTo(4, 9);
    // ...the model's units in the file.
    const inModel = quantitiesInModelUnits(store, si.quantities);
    const value = (name: string) => inModel.find((q) => q.name === name)?.value;
    expect(value('Length')).toBeCloseTo(4000, 6);
    expect(value('Height')).toBeCloseTo(3000, 6);
    expect(value('GrossSideArea')).toBeCloseTo(12, 9);
    expect(value('GrossVolume')).toBeCloseTo(2.4, 9);

    const copy = view.detachedCopy();
    const lifted = liftNativeModel(store, copy, { id: '00000000-0000-4000-8000-000000000000', name: '' });
    writeNativeExportSets(copy, lifted.model, lifted.expressIds, {}, store);
    const set = copy.getQuantitiesForEntity(wall)?.find((q) => q.name === 'Qto_WallBaseQuantities');
    expect(set?.quantities.find((q) => q.name === 'Length')?.value).toBeCloseTo(4000, 6);
  });
});
