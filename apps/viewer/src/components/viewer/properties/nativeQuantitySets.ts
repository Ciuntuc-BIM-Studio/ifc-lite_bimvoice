/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The base quantities of a native element, computed from its parameters
 * (`nativeElementQuantities`) for the Quantities tab: an element modelled in
 * Lapin shows its `Qto_*` set as an imported IFC element shows its file's,
 * live as it is edited. Display only — the model gets the set when an IFC
 * export writes it (N6) — and only when the element has no such set of its own.
 */

import { nativeElementQuantities } from '@ifc-lite/create';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { QuantitySet } from './encodingUtils';

export function withNativeQuantitySets(
  sets: QuantitySet[], store: IfcDataStore | null | undefined, view: MutablePropertyView | null | undefined, expressId: number,
): QuantitySet[] {
  if (!store || !view) return sets;
  try {
    const computed = nativeElementQuantities(store, view, expressId);
    if (!computed || sets.some((s) => s.name === computed.set)) return sets;
    return [...sets, { name: computed.set, derived: true, quantities: computed.quantities.map((q) => ({ name: q.name, value: q.value, type: q.quantityType })) }];
  } catch (err) {
    // A shape the native reader cannot follow shows the model's sets alone.
    console.warn('[properties] native quantities skipped for', expressId, err);
    return sets;
  }
}
