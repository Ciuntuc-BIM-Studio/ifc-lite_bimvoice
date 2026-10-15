/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a system's quantities read from the model beside its spec: the
 * terrain a corridor daylights to (its cut and fill), by GlobalId, as a TIN
 * in the corridor's storey frame (the frame its spec is in).
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { readTerrainTin, terrainsInStore } from '../in-store/corridor-store.js';
import { AnchorEntityReader, resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { nativeIdOf } from './lift-base.js';
import type { NativeId } from './schema.js';
import type { Tin } from '../civil/tin.js';

export interface SystemQuantityContext {
  /** The terrain `globalId` names, in the frame of the storey `storeyId` (native id); null when there is none. */
  terrain?: (globalId: string, storeyId: NativeId) => Tin | null;
}

/** A context reading terrains from `store` (memoised per terrain and storey). */
export function systemQuantityContext(store: IfcDataStore, view: MutablePropertyView): SystemQuantityContext {
  const memo = new Map<string, Tin | null>();
  let terrains: ReturnType<typeof terrainsInStore> | null = null;
  let storeys: Map<NativeId, number> | null = null;
  const storeyOf = (id: NativeId) => {
    if (!storeys) {
      const r = new AnchorEntityReader(store, view);
      storeys = new Map();
      for (const s of r.ids('IFCBUILDINGSTOREY')) { const n = nativeIdOf(r.entity(s)?.attributes[0]); if (n) storeys.set(n, s); }
    }
    return storeys.get(id);
  };
  return {
    terrain: (globalId, storeyId) => {
      const key = `${globalId}@${storeyId}`;
      if (!memo.has(key)) {
        terrains ??= terrainsInStore(store, view);
        const element = terrains.find((t) => t.globalId === globalId);
        const storey = storeyOf(storeyId);
        let tin: Tin | null = null;
        try {
          tin = element && storey !== undefined ? readTerrainTin(store, resolveSpatialAnchor(store, storey, view), element.id, view) : null;
        } catch {
          tin = null;
        }
        memo.set(key, tin);
      }
      return memo.get(key) ?? null;
    },
  };
}
