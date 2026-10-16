/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The base quantities of a native element, computed from its parameters
 * (`nativeElementQuantities`) for the Quantities tab: an element modelled in
 * Lapin shows its `Qto_*` set as an imported IFC element shows its file's,
 * live as it is edited. Display only — the model gets the set when an IFC
 * export writes it (N6). When the element has such a set of its own (written
 * by an earlier export, a Studio builder, another tool), that set is shown,
 * marked where its values are not what the parameters give now.
 * Compared in the model's units, as the file's values are.
 */

import { nativeElementQuantities, quantitiesInModelUnits } from '@ifc-lite/create';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { QuantitySet } from './encodingUtils';

export function withNativeQuantitySets(
  sets: QuantitySet[], store: IfcDataStore | null | undefined, view: MutablePropertyView | null | undefined, expressId: number,
): QuantitySet[] {
  if (!store || !view) return sets;
  try {
    const computed = nativeElementQuantities(store, view, expressId);
    if (!computed) return sets;
    const values = quantitiesInModelUnits(store, computed.quantities);
    const own = sets.find((s) => s.name === computed.set);
    if (!own) return [...sets, { name: computed.set, derived: true, quantities: values.map((q) => ({ name: q.name, value: q.value, type: q.quantityType })) }];
    const parametric: Record<string, number> = {};
    for (const q of values) {
      const file = own.quantities.find((x) => x.name === q.name);
      if (file && Math.abs(file.value - q.value) > 1e-6 * Math.max(1, Math.abs(q.value))) parametric[q.name] = q.value;
    }
    return Object.keys(parametric).length ? sets.map((s) => (s === own ? { ...s, parametric } : s)) : sets;
  } catch (err) {
    // A shape the native reader cannot follow shows the model's sets alone.
    console.warn('[properties] native quantities skipped for', expressId, err);
    return sets;
  }
}
