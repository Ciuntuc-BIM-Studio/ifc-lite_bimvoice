/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MutationStoreShape } from './types.js';

/**
 * The highest express id a store already owns — the floor for overlay
 * allocation. Three sources, because no single index is complete: the STEP
 * byte index, the property atoms the parser deferred out of it on huge files
 * (they sit above `max(byId)` and the exporter emits them), and the entity
 * table, which is the only membership record for stores without a byte
 * index (IFCX imports, reconstructed collab rooms — #5008).
 */
export function highestExistingExpressId(store: MutationStoreShape): number {
  // Every StoreEditor (each atomic edit's draft too) asks: the walk is the
  // model's size, so it is remembered per store while its indexes keep their size.
  const sizes = [store.entityIndex.byId.size, store.deferredEntityIndex?.size ?? -1, store.entities?.expressId?.length ?? -1];
  const known = watermarks.get(store);
  if (known && known.sizes.every((n, i) => n === sizes[i])) return known.max;
  const max = walk(store);
  watermarks.set(store, { sizes, max });
  return max;
}

const watermarks = new WeakMap<MutationStoreShape, { sizes: number[]; max: number }>();

function walk(store: MutationStoreShape): number {
  let max = 0;
  // @raw-entity-enumeration-ok allocator watermark must include tombstoned source IDs so a new entity never reuses one
  for (const id of store.entityIndex.byId.keys()) {
    if (id > max) max = id;
  }
  const deferred = store.deferredEntityIndex;
  if (deferred) {
    for (const id of deferred.keys()) {
      if (id > max) max = id;
    }
  }
  const table = store.entities?.expressId;
  if (table) {
    for (let i = 0; i < table.length; i++) {
      const id = table[i];
      if (id !== undefined && id > max) max = id;
    }
  }
  return max;
}
