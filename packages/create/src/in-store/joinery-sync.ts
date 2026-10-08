/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A project's joinery catalogue kept in step with a model. A catalogue entry
 * (`JoinerySpec.id`) is at most one type object per model, found by the id in
 * its Pset_IfcLiteJoinery:
 *  - `ensureJoineryTypeInStore` returns it, writing it the first time a door
 *    or window of that entry is placed;
 *  - `syncJoineryTypeInStore` rewrites it after the configurator changed the
 *    entry, and resizes every hosted occurrence (opening, filling and its
 *    OverallWidth / OverallHeight) whose size no longer matches, then gives
 *    each occurrence a fresh mapped body of the rewritten map;
 *  - `retypeOccurrencesInStore` moves occurrences to another entry: type
 *    relationship, size and body.
 * All run inside the caller's atomic edit.
 */

import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from './resolve-anchor.js';
import { readRelatedLists, resolveAuthoringAnchor } from './resolve-relations.js';
import { assignTypeInStore } from './element-type.js';
import { editHostedElementInStore, readHostedElementSize } from './hosted-element-edit.js';
import { readHostedFill } from './hosted-fill-read.js';
import { readJoineryFlips, readJoineryType } from './joinery-read.js';
import { addJoineryTypeToStore, emitMappedBody, replaceJoineryTypeInStore, type JoineryAnchor } from './joinery-type.js';
import type { JoinerySpec } from './joinery-spec.js';
import { attributeRefs, pruneOrphanOverlay } from './overlay-prune.js';

export interface JoineryInModel {
  typeId: number;
  mapId: number;
  globalId: string;
  spec: JoinerySpec;
}

/** Owner history, schema, units and the Body context a type's map is drawn in. */
export function resolveJoineryAnchor(store: IfcDataStore, view?: MutablePropertyView | null): JoineryAnchor {
  const reader = new AnchorEntityReader(store, view);
  const bodyContextId = reader.contextId('body', reader.rootContextId());
  if (bodyContextId === null) throw new Error('The model has no 3D representation context to draw joinery in');
  return { ...resolveAuthoringAnchor(store, view), bodyContextId };
}

/** Every configured joinery type in the model (doors and windows). */
export function joineryTypesInStore(store: IfcDataStore, view?: MutablePropertyView | null): JoineryInModel[] {
  const reader = new AnchorEntityReader(store, view);
  const out: JoineryInModel[] = [];
  for (const type of ['IFCWINDOWTYPE', 'IFCDOORTYPE']) {
    for (const typeId of reader.ids(type)) {
      const read = readJoineryType(store, typeId, view);
      if (read?.mapId != null) out.push({ typeId, mapId: read.mapId, globalId: read.globalId, spec: read.spec });
    }
  }
  return out;
}

/** The model's type for catalogue entry `id`, or null. */
export function findJoineryTypeInStore(store: IfcDataStore, id: string, view?: MutablePropertyView | null): JoineryInModel | null {
  return joineryTypesInStore(store, view).find((t) => t.spec.id === id) ?? null;
}

export function ensureJoineryTypeInStore(store: IfcDataStore, editor: StoreEditor, spec: JoinerySpec): JoineryInModel {
  const view = editor.getMutationView();
  const found = spec.id ? findJoineryTypeInStore(store, spec.id, view) : null;
  if (found) return found;
  const made = addJoineryTypeToStore(editor, resolveJoineryAnchor(store, view), spec);
  return { typeId: made.typeId, mapId: made.mapId, globalId: made.globalId, spec };
}

/** Occurrences typed by `typeId`. */
export function occurrencesOfTypeInStore(store: IfcDataStore, typeId: number, view?: MutablePropertyView | null): number[] {
  return readRelatedLists(store, 'IfcRelDefinesByType', view).filter((r) => r.relatingId === typeId).flatMap((r) => r.relatedIds);
}

/** Size a hosted occurrence to `spec` and map its body from `mapId`; returns what to re-mesh. */
function fitOccurrence(store: IfcDataStore, editor: StoreEditor, id: number, spec: JoinerySpec, mapId: number, bodyContextId: number): number[] {
  const view = editor.getMutationView();
  const kind = new AnchorEntityReader(store, view).entity(id)?.type.toUpperCase() ?? '';
  if (!kind.startsWith(spec.kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW')) throw new Error(`#${id} is not a ${spec.kind}`);
  const read = readHostedFill(store, id, view);
  if (!read || read.fillingId !== id) throw new Error(`#${id} is not hosted in a wall opening`);
  const size = readHostedElementSize(store, id, view);
  const eps = 1e-6;
  if (size && (Math.abs(size.OverallWidth - spec.width) > eps || Math.abs(size.OverallHeight - spec.height) > eps)) {
    editHostedElementInStore(store, editor, id, { OverallWidth: spec.width, OverallHeight: spec.height });
  }
  const flips = readJoineryFlips(store, id, view);
  const old = attributeRefs(editor, id, [6]);
  const { productShapeId } = emitMappedBody(editor, bodyContextId, mapId, flips);
  editor.setPositionalAttribute(id, 6, `#${productShapeId}`);
  pruneOrphanOverlay(editor, old);
  return [id, read.openingId, read.hostId];
}

/**
 * Turn a configured door / window in its opening (`emitMappedBody`'s
 * `flips`): a new mapped body of its type's map. Returns false when the
 * element has no configured type.
 */
export function setJoineryFlipsInStore(store: IfcDataStore, editor: StoreEditor, id: number, flips: number): boolean {
  const view = editor.getMutationView();
  const rel = readRelatedLists(store, 'IfcRelDefinesByType', view).find((r) => r.relatedIds.includes(id));
  const type = rel?.relatingId != null ? readJoineryType(store, rel.relatingId, view) : null;
  if (!type?.mapId) return false;
  const { bodyContextId } = resolveJoineryAnchor(store, view);
  const old = attributeRefs(editor, id, [6]);
  const { productShapeId } = emitMappedBody(editor, bodyContextId, type.mapId, flips & 3);
  editor.setPositionalAttribute(id, 6, `#${productShapeId}`);
  pruneOrphanOverlay(editor, old);
  return true;
}

export interface JoinerySyncResult {
  type: JoineryInModel | null;
  /** Products whose geometry changed. */
  remesh: number[];
  /** Occurrences that could not take the new size (they keep the old one). */
  refused: { id: number; reason: string }[];
}

/** Rewrite the model's type for `spec.id` (if the model has one) and refit its occurrences. */
export function syncJoineryTypeInStore(store: IfcDataStore, editor: StoreEditor, spec: JoinerySpec): JoinerySyncResult {
  const view = editor.getMutationView();
  const found = spec.id ? findJoineryTypeInStore(store, spec.id, view) : null;
  if (!found) return { type: null, remesh: [], refused: [] };
  const anchor = resolveJoineryAnchor(store, view);
  replaceJoineryTypeInStore(editor, anchor, found.typeId, found.mapId, found.globalId, spec);
  const remesh = new Set<number>();
  const refused: { id: number; reason: string }[] = [];
  for (const id of occurrencesOfTypeInStore(store, found.typeId, view)) {
    try {
      editor.runAtomic((draft) => fitOccurrence(store, draft, id, spec, found.mapId, anchor.bodyContextId)).forEach((r) => remesh.add(r));
    } catch (error) {
      refused.push({ id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { type: { ...found, spec }, remesh: [...remesh], refused };
}

/** Give hosted doors / windows `ids` the type of catalogue entry `spec` (writing it if needed). */
export function retypeOccurrencesInStore(store: IfcDataStore, editor: StoreEditor, spec: JoinerySpec, ids: readonly number[]): JoinerySyncResult {
  const type = ensureJoineryTypeInStore(store, editor, spec);
  const view = editor.getMutationView();
  const anchor = resolveJoineryAnchor(store, view);
  const remesh = new Set<number>();
  const refused: { id: number; reason: string }[] = [];
  const moved: number[] = [];
  for (const id of ids) {
    try {
      editor.runAtomic((draft) => fitOccurrence(store, draft, id, spec, type.mapId, anchor.bodyContextId)).forEach((r) => remesh.add(r));
      moved.push(id);
    } catch (error) {
      refused.push({ id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (moved.length) assignTypeInStore(editor, anchor, type.typeId, moved, readRelatedLists(store, 'IfcRelDefinesByType', view));
  return { type, remesh: [...remesh], refused };
}
