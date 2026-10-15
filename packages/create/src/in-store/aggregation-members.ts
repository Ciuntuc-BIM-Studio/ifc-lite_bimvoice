/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Every element in an aggregation (a whole or one of its parts), edits
 * included: what may be a block of parts (a roof system, a curtain wall), so
 * a selection of many elements asks the block lookups only about these.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { refId } from './curtain-wall-system.js';
import { AnchorEntityReader } from './resolve-anchor.js';

export function aggregationMembers(store: IfcDataStore, view?: MutablePropertyView | null): Set<number> {
  const reader = new AnchorEntityReader(store, view);
  const out = new Set<number>();
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const attrs = reader.entity(relId)?.attributes;
    const whole = refId(attrs?.[4]);
    if (whole !== null) out.add(whole);
    if (Array.isArray(attrs?.[5])) for (const part of attrs[5]) { const id = refId(part); if (id !== null) out.add(id); }
  }
  return out;
}
