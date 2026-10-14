/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView } from './mutable-property-view.js';

describe('overlay snapshots (the journal, N5)', () => {
  it('a snapshot put on a fresh view over the same source reads as the view it came from', () => {
    const view = new MutablePropertyView(null, 'm');
    const point = view.createEntity('IfcCartesianPoint', [[1, 2, 3]]);
    view.setPositionalAttribute(point.expressId, 0, [4, 5, 6]);
    view.setProperty(7, 'Pset_Lapin', 'Note', 'kept');
    view.deleteEntity(9);
    const snapshot = structuredClone(view.captureOverlaySnapshot());

    const restored = new MutablePropertyView(null, 'm');
    restored.restoreOverlaySnapshot(snapshot);
    expect(restored.getNewEntity(point.expressId)?.type).toBe('IfcCartesianPoint');
    expect(restored.getPositionalMutationsForEntity(point.expressId)?.get(0)).toEqual([4, 5, 6]);
    expect(restored.getPropertyValue(7, 'Pset_Lapin', 'Note')).toBe('kept');
    expect(restored.isDeleted(9)).toBe(true);
    expect(restored.getMutations().length).toBe(view.getMutations().length);
    // The next id it hands out follows the restored ones.
    expect(restored.createEntity('IfcDirection', [[0, 0, 1]]).expressId).toBe(view.createEntity('IfcDirection', [[0, 0, 1]]).expressId);
    // The snapshot is a copy: editing the restored view leaves it as it was.
    restored.setProperty(7, 'Pset_Lapin', 'Note', 'changed');
    expect(snapshot.propertyMutations.size).toBe(1);
  });
});
