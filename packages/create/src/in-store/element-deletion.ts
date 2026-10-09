/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What deleting elements takes with it, so nothing is left floating or
 * pointing at nothing: an assembly's parts (IfcRelAggregates / IfcRelNests:
 * a roof's planes and members, a stair's flights, a curtain wall's panels),
 * an element's openings (IfcRelVoidsElement) and what fills them
 * (IfcRelFillsElement) — a wall goes with its doors and windows — and a
 * door's or window's own opening, so the wall closes again. Spatial
 * structure (project, site, building, storey and their kin) is not deleted
 * here: levels have their own management.
 *
 * Relationships listing a deleted element need no edit: the exporter drops
 * references to removed entities, and an emptied relationship with them.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from './resolve-anchor.js';

const SPATIAL = new Set([
  'IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCFACILITY', 'IFCFACILITYPART',
  'IFCBRIDGE', 'IFCBRIDGEPART', 'IFCROAD', 'IFCROADPART', 'IFCRAILWAY', 'IFCRAILWAYPART', 'IFCMARINEFACILITY', 'IFCMARINEPART',
]);

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

export interface DeletionPlan {
  /** Everything to remove, the asked-for elements first. */
  ids: number[];
  /** Elements not removed, and why. */
  refused: { id: number; reason: string }[];
}

interface Links {
  children: Map<number, number[]>;
  openingsOf: Map<number, number[]>;
  fillingsOf: Map<number, number[]>;
  openingOfFilling: Map<number, number>;
}

function links(store: IfcDataStore, view?: MutablePropertyView | null): Links {
  const reader = new AnchorEntityReader(store, view);
  const out: Links = { children: new Map(), openingsOf: new Map(), fillingsOf: new Map(), openingOfFilling: new Map() };
  const push = (map: Map<number, number[]>, key: number, ids: number[]) => map.set(key, [...(map.get(key) ?? []), ...ids]);
  const related = (v: unknown) => (Array.isArray(v) ? v : [v]).map(refId).filter((id): id is number => id !== null);
  for (const type of ['IFCRELAGGREGATES', 'IFCRELNESTS']) {
    for (const relId of reader.ids(type)) {
      const rel = reader.entity(relId);
      const parent = refId(rel?.attributes[4]);
      if (rel && parent !== null) push(out.children, parent, related(rel.attributes[5]));
    }
  }
  for (const relId of reader.ids('IFCRELVOIDSELEMENT')) {
    const rel = reader.entity(relId);
    const host = refId(rel?.attributes[4]);
    if (rel && host !== null) push(out.openingsOf, host, related(rel.attributes[5]));
  }
  for (const relId of reader.ids('IFCRELFILLSELEMENT')) {
    const rel = reader.entity(relId);
    const opening = refId(rel?.attributes[4]);
    if (!rel || opening === null) continue;
    const fills = related(rel.attributes[5]);
    push(out.fillingsOf, opening, fills);
    for (const f of fills) out.openingOfFilling.set(f, opening);
  }
  return out;
}

/** The elements to remove for `ids`, with their dependants; spatial structure refused. */
export function deletionClosure(store: IfcDataStore, ids: readonly number[], view?: MutablePropertyView | null): DeletionPlan {
  const reader = new AnchorEntityReader(store, view);
  const l = links(store, view);
  const out: number[] = [];
  const seen = new Set<number>();
  const refused: DeletionPlan['refused'] = [];
  const visit = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const entity = reader.entity(id);
    if (!entity) return;
    out.push(id);
    for (const child of l.children.get(id) ?? []) visit(child);
    for (const opening of l.openingsOf.get(id) ?? []) visit(opening);
    for (const filling of l.fillingsOf.get(id) ?? []) visit(filling);
    const opening = l.openingOfFilling.get(id);
    if (opening !== undefined) visit(opening);
  };
  for (const id of ids) {
    const type = reader.entity(id)?.type?.toUpperCase();
    if (type && SPATIAL.has(type)) {
      refused.push({ id, reason: 'Levels, buildings and sites are managed in the Project navigator, not deleted as elements' });
      seen.add(id);
      continue;
    }
    visit(id);
  }
  return { ids: out, refused };
}
