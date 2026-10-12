/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the loaded IFC models say a material looks like (its surface colour
 * and drafting hatches, `readMaterialAppearance`), by material name: the
 * first model that gives the name an appearance wins. Cached until the
 * models change.
 */

import { materialsNamed, readMaterialAppearance, type MaterialAppearance } from '@ifc-lite/create';
import { iterateEffectiveEntityIds } from '@ifc-lite/mutations';
import { useViewerStore } from '@/store';

let cache: { version: unknown; models: unknown; byName: Map<string, MaterialAppearance | null> } | null = null;

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** The appearance the models give the material `name`, or null. */
export function ifcAppearanceOf(name: string): MaterialAppearance | null {
  const s = useViewerStore.getState();
  if (!cache || cache.version !== s.mutationVersion || cache.models !== s.models) cache = { version: s.mutationVersion, models: s.models, byName: new Map() };
  const k = key(name);
  if (cache.byName.has(k)) return cache.byName.get(k)!;
  let found: MaterialAppearance | null = null;
  for (const [modelId, model] of s.models) {
    const store = model.ifcDataStore;
    if (!store) continue;
    const view = s.mutationViews.get(modelId) ?? null;
    // Only models that style any material at all are searched.
    if (iterateEffectiveEntityIds(store, view, ['IFCMATERIALDEFINITIONREPRESENTATION']).next().done) continue;
    for (const id of materialsNamed(store, view, name)) {
      found = readMaterialAppearance(store, view, id);
      if (found) break;
    }
    if (found) break;
  }
  cache.byName.set(k, found);
  return found;
}
