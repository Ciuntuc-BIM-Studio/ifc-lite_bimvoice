/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Relocating elements:
 *
 * - to another storey: each element (with the parts it aggregates — a roof
 *   system's slabs and members, a corridor's courses) leaves its storey's
 *   `IfcRelContainedInSpatialStructure` for the target storey's, and every
 *   placement that hung from the old storey's placement hangs from the new
 *   one's. Kept relative to the storey (the default), the element keeps its
 *   offsets and so moves with the level: a roof drawn on the ground floor
 *   lands at the same height above the first floor. Kept in place, its
 *   offsets are recomputed so it stays where it was in space. Placements
 *   hanging from another element's (openings, doors in them, an assembly's
 *   parts) follow by themselves;
 * - by a new placement: an element's offsets and its angles about X, Y and
 *   Z in its parent's frame. Parts of it placed beside it (on the same
 *   parent, as a roof system's) are carried by the same rigid change.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from './resolve-anchor.js';
import { refId } from './host-geometry-frame.js';
import { effectiveStoreyId } from './edit/effective-storey.js';
import { objectPlacementOf, parentPlacementOf, type PlacementReader } from './element-transform-frames.js';
import { compose, frameOfTransform, invert, localFrame, transformOfFrame, worldFrame, writeLocalFrame, type PlacementTransform } from './placement-3d.js';

const refs = (v: unknown): number[] => (Array.isArray(v) ? v.map(refId).filter((x): x is number => x !== null) : []);

/** Everything `id` aggregates, all the way down (not `id` itself). */
export function aggregatedParts(store: IfcDataStore, view: ReturnType<StoreEditor['getMutationView']>, id: number): number[] {
  const r = new AnchorEntityReader(store, view);
  const children = new Map<number, number[]>();
  for (const relId of r.ids('IFCRELAGGREGATES')) {
    const rel = r.entity(relId);
    const whole = rel ? refId(rel.attributes[4]) : null;
    if (whole !== null) children.set(whole, [...(children.get(whole) ?? []), ...refs(rel!.attributes[5])]);
  }
  const out: number[] = [];
  const seen = new Set([id]);
  const walk = (x: number) => { for (const c of children.get(x) ?? []) if (!seen.has(c)) { seen.add(c); out.push(c); walk(c); } };
  walk(id);
  return out;
}

export interface ElementPlacement extends PlacementTransform {
  parentPlacementId: number | null;
  /** The element's storey, and whether its placement hangs straight from the storey's (else from a host's). */
  storeyId: number | null;
  onStorey: boolean;
}

/** An element's placement in its parent's frame, as offsets and angles; null when it has none readable. */
export function readElementPlacement(store: IfcDataStore, editor: Pick<StoreEditor, 'getMutationView'>, id: number): ElementPlacement | null {
  const view = editor.getMutationView();
  const r: PlacementReader = { dataStore: store, view };
  const lp = objectPlacementOf(r, id);
  const f = lp === null ? null : localFrame(r, lp);
  if (!f || lp === null) return null;
  const parentPlacementId = parentPlacementOf(r, lp);
  const storeyId = effectiveStoreyId(store, view, id) ?? null;
  const storeyPlacement = storeyId === null ? null : new AnchorEntityReader(store, view).storeyPlacementId(storeyId);
  return { ...transformOfFrame(f), parentPlacementId, storeyId, onStorey: storeyPlacement !== null && parentPlacementId === storeyPlacement };
}

/** Give an element a new placement in its parent's frame; returns the elements whose placement changed. */
export function setElementPlacementInStore(store: IfcDataStore, editor: StoreEditor, id: number, next: PlacementTransform): number[] {
  const op = 'setElementPlacementInStore';
  if (![next.x, next.y, next.z, next.rx, next.ry, next.rz].every(Number.isFinite)) throw new Error(`${op}: every value must be a number`);
  const view = editor.getMutationView();
  const r: PlacementReader = { dataStore: store, view };
  const lp = objectPlacementOf(r, id);
  const old = lp === null ? null : localFrame(r, lp);
  if (lp === null || !old) throw new Error(`${op}: #${id} has no local placement to change`);
  const target = frameOfTransform(next);
  writeLocalFrame(r, editor, lp, target);
  const changed = [id];
  // Parts placed beside the whole (on its parent) take the same rigid change.
  const parent = parentPlacementOf(r, lp);
  const change = compose(target, invert(old));
  for (const part of aggregatedParts(store, view, id)) {
    const plp = objectPlacementOf(r, part);
    const pf = plp === null || plp === lp || parentPlacementOf(r, plp) !== parent ? null : localFrame(r, plp);
    if (plp === null || !pf) continue;
    writeLocalFrame(r, editor, plp, compose(change, pf));
    changed.push(part);
  }
  return changed;
}

export type StoreyKeep = 'storey' | 'world';

export interface MoveToStoreyResult {
  /** The elements now on the target storey (parts included). */
  moved: number[];
  /** Elements on no storey, left where they were. */
  skipped: number[];
}

/** Move elements (and the parts they aggregate) to another storey. */
export function moveElementsToStoreyInStore(
  store: IfcDataStore, editor: StoreEditor, ids: readonly number[], targetStoreyId: number, keep: StoreyKeep = 'storey',
): MoveToStoreyResult {
  const op = 'moveElementsToStoreyInStore';
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const r: PlacementReader = { dataStore: store, view };
  const targetPlacement = reader.storeyPlacementId(targetStoreyId);
  if (targetPlacement === null) throw new Error(`${op}: #${targetStoreyId} is not a storey with a placement`);
  const all = [...new Set(ids.flatMap((id) => [id, ...aggregatedParts(store, view, id)]))];
  // Where each one is now, before anything changes.
  const from = new Map(all.map((id) => [id, effectiveStoreyId(store, view, id) ?? null]));
  const moving = all.filter((id) => from.get(id) !== null && from.get(id) !== targetStoreyId);
  const skipped = all.filter((id) => from.get(id) === null);
  if (!moving.length) return { moved: all.filter((id) => from.get(id) === targetStoreyId), skipped };
  const set = new Set(moving);

  // Containment: out of their storeys' relationships, into the target's.
  let ownerHistory: unknown = null;
  let targetRel: { id: number; related: number[] } | null = null;
  const joining: number[] = [];
  for (const relId of [...reader.ids('IFCRELCONTAINEDINSPATIALSTRUCTURE')]) {
    const rel = reader.entity(relId);
    if (!rel) continue;
    const relating = refId(rel.attributes[5]);
    const related = refs(rel.attributes[4]);
    if (relating === targetStoreyId) { targetRel ??= { id: relId, related }; continue; }
    if (relating === null || reader.entity(relating)?.type.toUpperCase() !== 'IFCBUILDINGSTOREY') continue;
    const leaving = related.filter((x) => set.has(x));
    if (!leaving.length) continue;
    ownerHistory ??= rel.attributes[1] ?? null;
    joining.push(...leaving);
    const remaining = related.filter((x) => !set.has(x));
    if (remaining.length) editor.setPositionalAttribute(relId, 4, remaining.map((x) => `#${x}`));
    else editor.removeEntity(relId);
  }
  if (joining.length) {
    if (targetRel) editor.setPositionalAttribute(targetRel.id, 4, [...new Set([...targetRel.related, ...joining])].map((x) => `#${x}`));
    else {
      const owner = typeof ownerHistory === 'number' ? `#${ownerHistory}` : typeof ownerHistory === 'string' ? ownerHistory : null;
      editor.addEntity('IfcRelContainedInSpatialStructure', [generateIfcGuid(), owner, null, null, joining.map((x) => `#${x}`), `#${targetStoreyId}`]);
    }
  }

  // Placements: those on the old storey's placement move to the new one's.
  const targetWorld = keep === 'world' ? worldFrame(r, targetPlacement) : null;
  if (keep === 'world' && !targetWorld) throw new Error(`${op}: the target storey's placement cannot be read`);
  for (const id of moving) {
    const lp = objectPlacementOf(r, id);
    const sourcePlacement = reader.storeyPlacementId(from.get(id)!);
    if (lp === null || sourcePlacement === null || parentPlacementOf(r, lp) !== sourcePlacement) continue;
    if (keep === 'storey') { editor.setPositionalAttribute(lp, 0, `#${targetPlacement}`); continue; }
    const own = localFrame(r, lp), sourceWorld = worldFrame(r, sourcePlacement);
    if (!own || !sourceWorld) throw new Error(`${op}: #${id}'s placement cannot be read`);
    writeLocalFrame(r, editor, lp, compose(invert(targetWorld!), compose(sourceWorld, own)), targetPlacement);
  }
  return { moved: [...moving, ...all.filter((id) => from.get(id) === targetStoreyId)], skipped };
}
