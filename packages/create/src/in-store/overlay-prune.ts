/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Dropping what an edit left behind. Rewriting an element's placement or
 * body (`replace*GeometryInStore`, roof regeneration, a door's new mapped
 * body) points the element at new records; the old placement, shape,
 * points, faces and their styled items stay in the overlay, referenced by
 * nothing, until export. `pruneOrphanOverlay` is a mark-and-sweep from the
 * records the edit let go of: an overlay-created record nothing live points
 * to is removed, then whatever it alone pointed to, and so on.
 *
 * Only overlay-created records are removed (a parsed record stays: the
 * source file's reverse references are not indexed here). Styled items and
 * presentation-layer assignments point AT geometry, so they never keep it
 * alive: they go (or lose the item) with it. An IfcRoot record (a product,
 * relationship, type or property set) is removed only when it is one of the
 * roots passed in, never because a walk reached it.
 */

import type { StoreEditor } from '@ifc-lite/mutations';

type Attr = Parameters<StoreEditor['addEntity']>[1][number];

const GUID = /^[0-9A-Za-z_$]{22}$/;
const DECORATORS = new Set(['IFCSTYLEDITEM', 'IFCPRESENTATIONLAYERASSIGNMENT', 'IFCPRESENTATIONLAYERWITHSTYLE']);

const refOf = (v: unknown): number | null => (typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null);

function collectRefs(v: unknown, out: number[]): number[] {
  if (Array.isArray(v)) for (const x of v) collectRefs(x, out);
  else {
    const id = refOf(v);
    if (id !== null) out.push(id);
  }
  return out;
}

/** An overlay record's attributes with its positional overrides applied. */
function effectiveAttributes(editor: StoreEditor, id: number): unknown[] | null {
  const created = editor.getNewEntity(id);
  if (!created) return null;
  const overrides = editor.getMutationView().getPositionalMutationsForEntity(id);
  if (!overrides?.size) return created.attributes;
  const attrs = created.attributes.slice();
  for (const [i, v] of overrides) attrs[i] = v;
  return attrs;
}

/** The records attributes `indices` of `id` point to now (overlay values; a parsed record's only through an override). */
export function attributeRefs(editor: StoreEditor, id: number, indices: readonly number[]): number[] {
  const overrides = editor.getMutationView().getPositionalMutationsForEntity(id);
  const attrs = editor.getNewEntity(id)?.attributes;
  return indices.flatMap((i) => collectRefs(overrides?.has(i) ? overrides.get(i) : attrs?.[i], []));
}

/** The ObjectPlacement and Representation an element points to now. */
export function elementGeometryRefs(editor: StoreEditor, elementId: number): number[] {
  return attributeRefs(editor, elementId, [5, 6]);
}

/**
 * Remove every overlay record reachable from `roots` that nothing live
 * references any more. Returns the removed ids. Call it after the edit has
 * rewired its references, in the same commit (so one undo restores both).
 */
export function pruneOrphanOverlay(editor: StoreEditor, roots: Iterable<number>): number[] {
  const view = editor.getMutationView();
  const explicit = new Set(roots);
  if (explicit.size === 0) return [];
  const refCount = new Map<number, number>();
  const decorators = new Map<number, number[]>();
  const bump = (id: number, by: number) => refCount.set(id, (refCount.get(id) ?? 0) + by);
  for (const e of view.getNewEntities()) {
    const attrs = effectiveAttributes(editor, e.expressId) ?? [];
    if (DECORATORS.has(e.type.toUpperCase())) {
      for (const target of collectRefs(e.type.toUpperCase() === 'IFCSTYLEDITEM' ? attrs[0] : attrs[2], [])) {
        decorators.set(target, [...(decorators.get(target) ?? []), e.expressId]);
      }
      // What a decorator points to besides its items (its styles) is kept alive by it.
      const own = e.type.toUpperCase() === 'IFCSTYLEDITEM' ? attrs.slice(1) : attrs.filter((_, i) => i !== 2);
      for (const id of collectRefs(own, [])) bump(id, 1);
      continue;
    }
    for (const id of collectRefs(attrs, [])) bump(id, 1);
  }
  // Parsed records point at overlay ones only through their overrides.
  for (const id of view.getAttributeOverrideEntityIds()) {
    if (view.getNewEntity(id) || view.isDeleted(id)) continue;
    for (const v of view.getPositionalMutationsForEntity(id)?.values() ?? []) for (const r of collectRefs(v, [])) bump(r, 1);
    for (const { value } of view.getAttributeMutationsForEntity(id)) for (const r of collectRefs(value, [])) bump(r, 1);
  }

  const removed: number[] = [];
  const queue = [...explicit];
  const dropDecorator = (decoratorId: number, itemId: number) => {
    const deco = editor.getNewEntity(decoratorId);
    if (!deco || view.isDeleted(decoratorId)) return;
    const attrs = effectiveAttributes(editor, decoratorId) ?? [];
    if (deco.type.toUpperCase() === 'IFCSTYLEDITEM') {
      editor.removeEntity(decoratorId);
      removed.push(decoratorId);
      for (const id of collectRefs(attrs.slice(1), [])) { bump(id, -1); queue.push(id); }
      return;
    }
    const items = Array.isArray(attrs[2]) ? attrs[2].filter((v) => refOf(v) !== itemId) : [];
    if (items.length) editor.setPositionalAttribute(decoratorId, 2, items as Attr);
    else {
      editor.removeEntity(decoratorId);
      removed.push(decoratorId);
    }
  };
  while (queue.length) {
    const id = queue.pop()!;
    const entity = editor.getNewEntity(id);
    if (!entity || view.isDeleted(id) || (refCount.get(id) ?? 0) > 0) continue;
    const attrs = effectiveAttributes(editor, id) ?? [];
    if (!explicit.has(id) && typeof attrs[0] === 'string' && GUID.test(attrs[0])) continue;
    for (const d of decorators.get(id) ?? []) dropDecorator(d, id);
    if (!editor.removeEntity(id)) continue;
    removed.push(id);
    for (const ref of collectRefs(attrs, [])) { bump(ref, -1); queue.push(ref); }
  }
  return removed;
}
