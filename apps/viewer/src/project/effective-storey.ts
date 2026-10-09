/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * An element's storey as the model has it now — after it was moved to
 * another storey, or that move was undone — falling back to the storey it
 * was loaded on (authored elements registered in the spatial hierarchy).
 */

import { useViewerStore } from '@/store';
import { elementStoreyId } from '@/lib/commands/modeling/workplane';

export function storeyOfElement(modelId: string, id: number): number | null {
  const s = useViewerStore.getState();
  return elementStoreyId(s, modelId, id) ?? s.models.get(modelId)?.ifcDataStore?.spatialHierarchy?.elementToStorey.get(id) ?? null;
}
