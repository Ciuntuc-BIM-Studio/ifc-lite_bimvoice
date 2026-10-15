/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Whether a renderer id is a whole or a part of an aggregation: the only
 * elements that can belong to a block (a roof system, a curtain wall). The
 * block lookups parse and scan per element; this set is built once per model
 * and edit, so a window over thousands of elements stays quick.
 */

import { aggregationMembers } from '@ifc-lite/create';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';

const cache = new Map<string, { store: IfcDataStore; version: number; ids: Set<number> }>();

export function inAggregation(renderId: number): boolean {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const store = ref ? s.models.get(ref.modelId)?.ifcDataStore : undefined;
  if (!ref || !store) return false;
  let entry = cache.get(ref.modelId);
  if (!entry || entry.store !== store || entry.version !== s.mutationVersion) {
    let ids = new Set<number>();
    try { ids = aggregationMembers(store, s.mutationViews.get(ref.modelId) ?? null); } catch { ids = new Set(); }
    cache.set(ref.modelId, entry = { store, version: s.mutationVersion, ids });
  }
  return entry.ids.has(ref.expressId);
}
