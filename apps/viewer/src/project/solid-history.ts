/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A Studio solid's history written into the model (N3): how it was built,
 * as `Pset_LapinSolid` beside its body, so the element is a native solid
 * wherever its IFC goes — recognized, measured and rebuilt from it — not
 * only while this project's sketches are at hand.
 */

import { NATIVE_SOLID_PSET, type NativeSolidShape } from '@ifc-lite/create';
import { PropertyValueType } from '@ifc-lite/data';
import type { StoreEditor } from '@ifc-lite/mutations';

export function writeSolidHistory(editor: StoreEditor, elementId: number, shape: NativeSolidShape): void {
  editor.getMutationView().setProperty(elementId, NATIVE_SOLID_PSET, 'Spec', JSON.stringify(shape), PropertyValueType.Text);
}
