/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What an IFC export of a model adds for the elements the native schema
 * describes (N6): their base quantities, computed from their parameters, and
 * `Pset_LapinNative` for a Lapin re-import; and a live Union / Intersect's
 * tools written once, as part of their target's body, not again as elements
 * of their own. Written on a copy of the model's view, so the session's
 * overlay and history never see them.
 */

import { liftNativeModel, omitCombinedToolsInStore, writeNativeExportSets } from '@ifc-lite/create';
import type { IfcDataStore } from '@ifc-lite/parser';
import { StoreEditor, type MutablePropertyView } from '@ifc-lite/mutations';

/** Any NativeId names the lifted model here: only its elements' sets are written. */
const EXPORT_MODEL_ID = '00000000-0000-4000-8000-000000000000';

/**
 * A copy of `view` with what an export adds for the elements the native
 * schema describes (N6, `writeNativeExportSets`): their base quantities and
 * `Pset_LapinNative`. The session's own view is never written.
 */
export function withNativeExportSets(dataStore: IfcDataStore, view: MutablePropertyView, options: { keepCombinedTools?: boolean } = {}): MutablePropertyView {
  try {
    const copy = view.detachedCopy();
    // The project's own copy keeps them: they are editable elements there.
    if (!options.keepCombinedTools) omitCombinedToolsInStore(dataStore, new StoreEditor(dataStore, copy));
    const lifted = liftNativeModel(dataStore, copy, { id: EXPORT_MODEL_ID, name: '' });
    writeNativeExportSets(copy, lifted.model, lifted.expressIds);
    return copy;
  } catch (error) {
    console.warn('[export] native quantities and parameters were not written', error);
    return view;
  }
}


/** A copy of `view` with a live Union / Intersect's tools left to their target's body (`view` itself when it has none). */
export function withoutCombinedTools(dataStore: IfcDataStore, view: MutablePropertyView): MutablePropertyView {
  try {
    const copy = view.detachedCopy();
    return omitCombinedToolsInStore(dataStore, new StoreEditor(dataStore, copy)).length ? copy : view;
  } catch (error) {
    console.warn('[export] combined tools were not left to their targets', error);
    return view;
  }
}
