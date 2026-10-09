/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which configurator library an element takes its type from, and changing it
 * from the properties: walls, slabs, columns and beams from the element
 * types (`element-types/`), doors and windows from the joinery catalogue
 * (`joinery/`), roof systems — the roof or any of its planes and members —
 * from the roof types. Picking an entry types the element by it and fits it
 * (layers and thickness, section, size, covering and structure) in one undo
 * step; "Edit types…" opens the configurator on the current entry.
 */

import { readRoofSystem, roofSystemOf } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { authoredKindOf } from '@/lib/commands/modeling/authored-kinds';
import { applyRoofSystem } from '@/project/roof-system-element';
import { catalogue, joineryEntry, retypeJoineryElements } from '@/joinery/catalog';
import { joineryOfElement } from '@/joinery/element-spec';
import { openJoinery } from '@/joinery/dialog-store';
import { elementType, elementTypes } from './catalog';
import { elementTypeOfElement, retypeElements, roofSpecFromType } from './model-sync';
import { openElementTypes } from './dialog-store';
import type { RoofTypeSpec } from './spec';

export type SlotKind = 'wall' | 'slab' | 'column' | 'beam' | 'door' | 'window' | 'roof';

export interface TypeOption {
  id: string;
  label: string;
}

export interface TypeSlot {
  modelId: string;
  /** The element itself; for a roof system, its IfcRoof. */
  elementId: number;
  kind: SlotKind;
  options: TypeOption[];
  /** The entry the element is typed by, or null. */
  current: string | null;
  /** Label of a type the element has but the library does not list (it came with the model). */
  foreign?: string;
}

const label = (e: { mark?: string; name: string }) => (e.mark ? `${e.mark} · ${e.name}` : e.name);
const ELEMENT_KINDS: readonly string[] = ['wall', 'slab', 'column', 'beam'];
const isElementKind = (k: string | null): k is 'wall' | 'slab' | 'column' | 'beam' => k !== null && ELEMENT_KINDS.includes(k);

/** The type slot of element `expressId` in `modelId`, or null when no configurator covers it. */
export function typeSlotOf(modelId: string, expressId: number): TypeSlot | null {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  if (!dataStore) return null;
  const view = s.mutationViews.get(modelId) ?? null;
  let roofId: number | null = null;
  try { roofId = roofSystemOf(dataStore, expressId, view); } catch { roofId = null; }
  if (roofId !== null) {
    const spec = readRoofSystem(dataStore, roofId, view);
    const roofs = elementTypes().filter((e): e is RoofTypeSpec => e.kind === 'roof');
    return {
      modelId, elementId: roofId, kind: 'roof', options: roofs.map((e) => ({ id: e.id, label: label(e) })),
      current: spec?.typeId && roofs.some((e) => e.id === spec.typeId) ? spec.typeId : null,
    };
  }
  const kind = authoredKindOf({ dataStore, view }, expressId);
  if (kind === 'door' || kind === 'window') {
    const typed = joineryOfElement(modelId, expressId);
    const options = catalogue().filter((e) => e.kind === kind && e.id).map((e) => ({ id: e.id!, label: label(e) }));
    const listed = typed?.spec.id && options.some((o) => o.id === typed.spec.id);
    return { modelId, elementId: expressId, kind, options, current: listed ? typed!.spec.id! : null, foreign: typed && !listed ? label(typed.spec) : undefined };
  }
  if (isElementKind(kind)) {
    const options = elementTypes().filter((e) => e.kind === kind).map((e) => ({ id: e.id, label: label(e) }));
    return { modelId, elementId: expressId, kind, options, current: elementTypeOfElement(modelId, expressId)?.id ?? null };
  }
  return null;
}

/** Type the slot's element by entry `id` and fit it. Ok, or why not. */
export function changeType(slot: TypeSlot, id: string): { ok: true } | { ok: false; error: string } {
  if (slot.kind === 'door' || slot.kind === 'window') {
    const spec = joineryEntry(id);
    if (!spec) return { ok: false, error: 'Type not in the catalogue' };
    const out = retypeJoineryElements(slot.modelId, [slot.elementId], spec);
    return out.refused.length ? { ok: false, error: out.refused.join('; ') } : { ok: true };
  }
  const entry = elementType(id);
  if (!entry) return { ok: false, error: 'Type not in the catalogue' };
  if (slot.kind === 'roof' && entry.kind === 'roof') {
    const s = useViewerStore.getState();
    const dataStore = s.models.get(slot.modelId)?.ifcDataStore;
    const spec = dataStore ? readRoofSystem(dataStore, slot.elementId, s.mutationViews.get(slot.modelId) ?? null) : null;
    if (!spec) return { ok: false, error: 'Not a roof system' };
    return applyRoofSystem({ modelId: slot.modelId, roofId: slot.elementId }, roofSpecFromType(spec, entry));
  }
  if (entry.kind !== slot.kind) return { ok: false, error: 'Type of another kind' };
  return retypeElements(slot.modelId, [slot.elementId], entry) ? { ok: true } : { ok: false, error: 'The element could not take the type' };
}

/** Open the slot's configurator on its current entry. */
export function editTypes(slot: TypeSlot): void {
  if (slot.kind === 'door' || slot.kind === 'window') openJoinery(slot.current);
  else openElementTypes(slot.kind, slot.current);
}
