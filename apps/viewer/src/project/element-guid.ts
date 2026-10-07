/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The IFC GlobalId behind a renderer (federation-global) id — the key the
 * project file uses for anything it says about a model element, so it
 * survives reloads and re-federation. Parsed and session-created elements alike.
 */

import { useViewerStore } from '@/store';

export function renderIdGlobalId(id: number): string | null {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(id);
  if (!ref) return null;
  const created = s.mutationViews.get(ref.modelId)?.getNewEntity(ref.expressId);
  if (created) return typeof created.attributes[0] === 'string' ? created.attributes[0] : null;
  return s.models.get(ref.modelId)?.ifcDataStore?.entities.getGlobalId(ref.expressId) || null;
}

/** The GlobalIds of the current selection. */
export function selectedGlobalIds(): string[] {
  const s = useViewerStore.getState();
  const ids = new Set(s.selectedEntityIds);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  return [...ids].map(renderIdGlobalId).filter((g): g is string => !!g);
}
