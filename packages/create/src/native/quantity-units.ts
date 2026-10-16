/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Native quantities are SI (metres, m², m³). An IFC file's quantities are in
 * its project's units (a millimetre model's IfcQuantityLength is in mm): the
 * export writes them, and the properties panel compares them with the file's,
 * in those units.
 */

import { QuantityType } from '@ifc-lite/data';
import { extractProjectUnits, type IfcDataStore } from '@ifc-lite/parser';
import { getModelLengthUnitScale } from '../in-store/edit/length-unit-scale.js';

interface Quantity { name: string; value: number; quantityType: QuantityType }

const scales = new WeakMap<IfcDataStore, Partial<Record<QuantityType, number>>>();

/** The SI scale of the model's length, area and volume units (1 when undeclared). */
function unitScales(store: IfcDataStore): Partial<Record<QuantityType, number>> {
  let out = scales.get(store);
  if (!out) {
    const length = getModelLengthUnitScale(store);
    // Undeclared area and volume units are SI.
    let area = 1, volume = 1;
    try {
      const units = extractProjectUnits(store.source, store.entityIndex);
      area = units.resolvedForUnitType('AREAUNIT')?.siScale ?? 1;
      volume = units.resolvedForUnitType('VOLUMEUNIT')?.siScale ?? 1;
    } catch {
      // Units that cannot be read: SI areas and volumes.
    }
    out = { [QuantityType.Length]: length, [QuantityType.Area]: area, [QuantityType.Volume]: volume };
    scales.set(store, out);
  }
  return out;
}

/** `quantities` (SI) in `store`'s project units. */
export function quantitiesInModelUnits<Q extends Quantity>(store: IfcDataStore, quantities: readonly Q[]): Q[] {
  const s = unitScales(store);
  return quantities.map((q) => {
    const scale = s[q.quantityType];
    return scale && scale !== 1 ? { ...q, value: q.value / scale } : q;
  });
}
