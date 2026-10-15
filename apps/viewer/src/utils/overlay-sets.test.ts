/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * N3: sets the session wrote as entities (as the Lapin tools write them)
 * read through the view like the file's — on the element, on a created
 * type, its quantities — and an edit of one goes to its member entity.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { PropertyValueType, QuantityType } from '@ifc-lite/data';
import { configureMutationView } from './configureMutationView';
import { authoredNominalValue, overlayPropertyMember, overlayTypeProperties } from './overlay-sets';
import { overlayMaterials } from '@/lib/authoring/association-overlay';
import { attributesFromOverlayEntity } from '@/components/viewer/properties/overlayAttributes';

const bytes = readFileSync(new URL('../../public/samples/hello-wall.ifc', import.meta.url));

describe('overlay sets', () => {
  it('reads authored property and quantity sets, a created type\'s, and edits a member in place', async () => {
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    configureMutationView(view, store);
    const editor = new StoreEditor(store, view);
    const wall = editor.addEntity('IfcWall', ['0abcdefghijklmnopqrstu', null, 'W', null, null, null, null, null, '.STANDARD.']).expressId;
    const fire = editor.addEntity('IfcPropertySingleValue', ['FireRating', null, { typed: { type: 'IfcLabel', value: 'EI 60' } }, null]).expressId;
    const ext = editor.addEntity('IfcPropertySingleValue', ['IsExternal', null, { typed: { type: 'IfcBoolean', value: true } }, null]).expressId;
    const pset = editor.addEntity('IfcPropertySet', ['1abcdefghijklmnopqrstu', null, 'Pset_WallCommon', null, [`#${fire}`, `#${ext}`]]).expressId;
    editor.addEntity('IfcRelDefinesByProperties', ['2abcdefghijklmnopqrstu', null, null, null, [`#${wall}`], `#${pset}`]);
    const len = editor.addEntity('IfcQuantityLength', ['Length', null, null, 6]).expressId;
    const qset = editor.addEntity('IfcElementQuantity', ['3abcdefghijklmnopqrstu', null, 'Qto_WallBaseQuantities', null, null, [`#${len}`]]).expressId;
    editor.addEntity('IfcRelDefinesByProperties', ['4abcdefghijklmnopqrstu', null, null, null, [`#${wall}`], `#${qset}`]);
    const u = editor.addEntity('IfcPropertySingleValue', ['ThermalTransmittance', null, { typed: { type: 'IfcThermalTransmittanceMeasure', value: 0.24 } }, null]).expressId;
    const tset = editor.addEntity('IfcPropertySet', ['5abcdefghijklmnopqrstu', null, 'Pset_WallCommon', null, [`#${u}`]]).expressId;
    const type = editor.addEntity('IfcWallType', ['6abcdefghijklmnopqrstu', null, 'WT', null, null, [`#${tset}`], null, null, null, '.SOLIDWALL.']).expressId;
    editor.addEntity('IfcRelDefinesByType', ['7abcdefghijklmnopqrstu', null, null, null, [`#${wall}`], `#${type}`]);

    const sets = view.getForEntity(wall);
    assert.deepEqual(sets.map((s) => [s.name, s.properties.map((p) => [p.name, p.value, p.type])]),
      [['Pset_WallCommon', [['FireRating', 'EI 60', PropertyValueType.Label], ['IsExternal', true, PropertyValueType.Boolean]]]]);
    assert.deepEqual(view.getQuantitiesForEntity(wall).map((q) => [q.name, q.quantities.map((x) => [x.name, x.value, x.type])]),
      [['Qto_WallBaseQuantities', [['Length', 6, QuantityType.Length]]]]);
    const typed = overlayTypeProperties(store, view, wall);
    assert.equal(typed?.typeName, 'WT');
    assert.deepEqual(typed?.properties.map((s) => s.properties.map((p) => [p.name, p.value])), [[['ThermalTransmittance', 0.24]]]);

    // An edit of an authored member is written on it: the set stays one, with the new value.
    const member = overlayPropertyMember(store, view, wall, 'Pset_WallCommon', 'FireRating');
    assert.equal(member?.id, fire);
    view.setPositionalAttribute(fire, 2, authoredNominalValue('EI 90', PropertyValueType.Label, member!.ifcType)!);
    assert.deepEqual(view.getForEntity(wall).map((s) => s.properties.find((p) => p.name === 'FireRating')?.value), ['EI 90']);
    // A deleted set no longer reads.
    view.deleteEntity(pset);
    assert.deepEqual(view.getForEntity(wall), []);
  });

  it('names a created element\'s attributes and resolves its layered material as the parser does', async () => {
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const wall = editor.addEntity('IfcWall', ['0abcdefghijklmnopqrstu', null, 'W-01', null, null, '#1', '#2', 'T1', '.STANDARD.']);
    assert.deepEqual(attributesFromOverlayEntity(view.getNewEntity(wall.expressId)!), [{ name: 'Name', value: 'W-01' }, { name: 'Tag', value: 'T1' }, { name: 'PredefinedType', value: 'STANDARD' }]);
    const brick = editor.addEntity('IfcMaterial', ['Brick', null, 'Masonry']).expressId;
    const plaster = editor.addEntity('IfcMaterial', ['Plaster', null, null]).expressId;
    const l1 = editor.addEntity('IfcMaterialLayer', [`#${brick}`, 0.2, null, 'Core', null, null, null]).expressId;
    const l2 = editor.addEntity('IfcMaterialLayer', [`#${plaster}`, 0.02, null, null, null, null, null]).expressId;
    const set = editor.addEntity('IfcMaterialLayerSet', [[`#${l1}`, `#${l2}`], 'Brick 22', null]).expressId;
    const usage = editor.addEntity('IfcMaterialLayerSetUsage', [`#${set}`, '.AXIS2.', '.POSITIVE.', -0.11, null]).expressId;
    editor.addEntity('IfcRelAssociatesMaterial', ['8abcdefghijklmnopqrstu', null, null, null, [`#${wall.expressId}`], `#${usage}`]);
    const [material] = overlayMaterials(view, [wall.expressId], 'IFC4', store);
    assert.equal(material.type, 'MaterialLayerSet');
    assert.equal(material.name, 'Brick 22');
    assert.deepEqual(material.layers?.map((l) => [l.materialName, l.thickness, l.name, l.materialCategory]), [['Brick', 0.2, 'Core', 'Masonry'], ['Plaster', 0.02, undefined, undefined]]);
  });
});
