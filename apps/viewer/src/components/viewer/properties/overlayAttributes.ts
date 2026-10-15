/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { NewEntity } from '@ifc-lite/mutations';
import { getRawNamedAttributes, type IfcAttributeValue } from '@ifc-lite/parser';

/** One authored value as the panel shows a parsed one (`EntityNode.allAttributes`): enums bare, references and lists left out. */
function display(raw: IfcAttributeValue): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'string') {
    if (raw === '$' || raw === '*' || raw.length === 0 || /^#\d+$/.test(raw) || raw === '.U.' || raw === '.X.') return null;
    if (raw === '.T.') return 'true';
    if (raw === '.F.') return 'false';
    return raw.startsWith('.') && raw.endsWith('.') && raw.length > 2 ? raw.slice(1, -1) : raw;
  }
  // A typed value, IFCLABEL('x'): its inner value.
  if (Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'string' && !Array.isArray(raw[1])) return display(raw[1] as IfcAttributeValue);
  return null;
}

/**
 * The display attributes of an entity created this session, named by the
 * schema and skipped as a parsed entity's are (GlobalId, OwnerHistory,
 * placement and representation), so a native element reads as an IFC one.
 */
export function attributesFromOverlayEntity(
  entity: NewEntity,
): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const { name, raw } of getRawNamedAttributes({ expressId: entity.expressId, type: entity.type, attributes: entity.attributes })) {
    const value = display(raw);
    if (value !== null) out.push({ name, value });
  }
  return out;
}
