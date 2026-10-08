/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What an element tag shows: a model element's live Name, Tag (its mark)
 * or IFC class — edits included (`effectiveListStringAttribute`, the lists'
 * own reader). Elements are found by GlobalId across the loaded models, so
 * a tag keeps pointing at its element whatever the session's ids.
 */

import { getAttributeNamesForSchema } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { effectiveListStringAttribute } from '@/lib/lists/effective-provider-entities';
import { findElementByGlobalId } from './contour-element';

export type TagField = 'mark' | 'name' | 'class';

export const TAG_FIELDS: readonly TagField[] = ['mark', 'name', 'class'];

/** The element a GlobalId names, in whichever loaded model holds it. */
export function elementByGlobalId(globalId: string): { modelId: string; expressId: number } | null {
  for (const modelId of useViewerStore.getState().models.keys()) {
    const expressId = findElementByGlobalId(modelId, globalId);
    if (expressId !== null) return { modelId, expressId };
  }
  return null;
}

function attribute(modelId: string, expressId: number, name: string): string {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  if (!dataStore) return '';
  const view = s.mutationViews.get(modelId);
  const created = view?.getNewEntity(expressId);
  return effectiveListStringAttribute(dataStore, view ?? undefined, expressId, name, () => {
    const entity = created ?? dataStore.getEntity(expressId);
    const slot = entity ? getAttributeNamesForSchema(entity.type, dataStore.schemaVersion).indexOf(name) : -1;
    const value = slot < 0 ? undefined : entity?.attributes[slot];
    return typeof value === 'string' ? value : '';
  });
}

/** The tag text of an element, or null when it is no longer in the model. The mark falls back to the name. */
export function elementLabel(globalId: string, field: TagField): string | null {
  const at = elementByGlobalId(globalId);
  if (!at) return null;
  const s = useViewerStore.getState();
  if (field === 'class') {
    const type = s.mutationViews.get(at.modelId)?.getNewEntity(at.expressId)?.type
      ?? s.models.get(at.modelId)?.ifcDataStore?.entities.getTypeName(at.expressId) ?? '';
    return type.replace(/^Ifc/i, '') || '?';
  }
  const name = attribute(at.modelId, at.expressId, 'Name');
  if (field === 'name') return name || '?';
  return attribute(at.modelId, at.expressId, 'Tag') || name || '?';
}
