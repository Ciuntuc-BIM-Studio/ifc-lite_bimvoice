/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A roof system behaves as one block: a click on any of its planes or
 * members selects the whole roof, the roof itself inspected
 * (`element-groups.ts`' block resolvers). A double click, or Edit roof,
 * enters the block (`startRoofEdit`): the rest fades, its parts are picked
 * one by one, and each edit to a part is an override on the roof
 * (`@ifc-lite/create`'s roof-overrides) — kept when the roof regenerates.
 */

import { readRoofSystem, roofSystemOf, roofSystemParts, type RoofPartOverride, type RoofSystemSpec } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { ELEMENT_DOUBLE_CLICK_EVENT } from '@/components/viewer/selectionHandlers';
import { registerBlockResolver } from './element-groups';
import { applyRoofSystem, roofSystemOfRenderId } from './roof-system-element';
import { startRoofEdit, useRoofDialog } from './roof-dialog-store';

export interface RoofPartRef {
  modelId: string;
  roofId: number;
  partId: number;
  /** The part's key (its Tag), what overrides are kept by. */
  key: string;
  kind: 'plane' | 'member';
  role: string;
  spec: RoofSystemSpec;
}

function live(modelId: string) {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  return dataStore ? { s, dataStore, view: s.mutationViews.get(modelId) ?? null } : null;
}

/** The roof block of a renderer id: its parts and the roof (null for the parts of a roof being edited). */
function roofBlock(renderId: number): { members: number[]; primary: number } | null {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const l = ref ? live(ref.modelId) : null;
  if (!ref || !l) return null;
  let roofId: number | null = null;
  try { roofId = roofSystemOf(l.dataStore, ref.expressId, l.view); } catch { roofId = null; }
  if (roofId === null) return null;
  const editing = useRoofDialog.getState().editing;
  if (editing?.modelId === ref.modelId && editing.roofId === roofId) return null;
  const parts = roofSystemParts(l.dataStore, roofId, l.view);
  return { members: parts.map((id) => toGlobalIdFromModels(s.models, ref.modelId, id)), primary: toGlobalIdFromModels(s.models, ref.modelId, roofId) };
}

/** Enter the roof of a renderer id as a block; false when it is not part of one. */
export function editRoofBlock(renderId: number): boolean {
  const roof = roofSystemOfRenderId(renderId);
  const l = roof ? live(roof.modelId) : null;
  if (!roof || !l) return false;
  startRoofEdit(roof, roofSystemParts(l.dataStore, roof.roofId, l.view));
  useViewerStore.getState().setSelectedEntityIds([]);
  return true;
}

/** The part a renderer id is, inside the roof being edited; null otherwise. */
export function roofPartOfRenderId(renderId: number): RoofPartRef | null {
  const editing = useRoofDialog.getState().editing;
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  if (!editing || !ref || ref.modelId !== editing.modelId || ref.expressId === editing.roofId) return null;
  const l = live(ref.modelId);
  if (!l || !roofSystemParts(l.dataStore, editing.roofId, l.view).includes(ref.expressId)) return null;
  const spec = readRoofSystem(l.dataStore, editing.roofId, l.view);
  const entity = l.view?.getNewEntity(ref.expressId) ?? l.dataStore.getEntity(ref.expressId);
  const key = String(entity?.attributes[7] ?? '');
  if (!spec || !key) return null;
  const kind = key.startsWith('plane:') ? 'plane' : 'member';
  // A truss part's key is truss:<n>:<role>:<m>.
  const segments = key.split(':');
  const role = segments[0] === 'truss' ? segments[2] ?? 'chord' : segments[0];
  return { modelId: ref.modelId, roofId: editing.roofId, partId: ref.expressId, key, kind, role, spec };
}

/** Change (or clear, with null) a part's override; the roof regenerates. */
export function setPartOverride(part: Pick<RoofPartRef, 'modelId' | 'roofId' | 'key' | 'spec'>, patch: RoofPartOverride | null): { ok: true } | { ok: false; error: string } {
  const overrides = { ...(part.spec.overrides ?? {}) };
  if (patch === null) delete overrides[part.key];
  else overrides[part.key] = { ...overrides[part.key], ...patch };
  const result = applyRoofSystem(part, { ...part.spec, overrides });
  if (result.ok) refreshRoofIsolation(part.modelId, part.roofId);
  return result;
}

/** Bring back every deleted part of the roof being edited. */
export function restoreDeletedParts(modelId: string, roofId: number): { ok: true } | { ok: false; error: string } {
  const l = live(modelId);
  const spec = l ? readRoofSystem(l.dataStore, roofId, l.view) : null;
  if (!spec) return { ok: false, error: 'Not a roof system' };
  const overrides: NonNullable<RoofSystemSpec['overrides']> = {};
  for (const [key, o] of Object.entries(spec.overrides ?? {})) {
    const { deleted: _deleted, ...rest } = o;
    if (Object.keys(rest).length) overrides[key] = rest;
  }
  const result = applyRoofSystem({ modelId, roofId }, { ...spec, overrides });
  if (result.ok) refreshRoofIsolation(modelId, roofId);
  return result;
}

/** Deleted parts of a roof. */
export function deletedPartCount(modelId: string, roofId: number): number {
  const l = live(modelId);
  const spec = l ? readRoofSystem(l.dataStore, roofId, l.view) : null;
  return Object.values(spec?.overrides ?? {}).filter((o) => o.deleted).length;
}

/** Parts come and go on regeneration: keep the edit mode's isolation on the current ones. */
function refreshRoofIsolation(modelId: string, roofId: number): void {
  const editing = useRoofDialog.getState().editing;
  if (!editing || editing.modelId !== modelId || editing.roofId !== roofId) return;
  const l = live(modelId);
  if (!l) return;
  const ids = [roofId, ...roofSystemParts(l.dataStore, roofId, l.view)].map((id) => toGlobalIdFromModels(l.s.models, modelId, id));
  l.s.isolateEntities(ids);
}

let installed = false;
/** Mount once: roofs select as blocks, and a double click enters one. */
export function installRoofBlocks(): void {
  if (installed) return;
  installed = true;
  registerBlockResolver(roofBlock);
  window.addEventListener(ELEMENT_DOUBLE_CLICK_EVENT, (e) => {
    const id = (e as CustomEvent<number>).detail;
    if (typeof id === 'number' && !useRoofDialog.getState().editing) editRoofBlock(id);
  });
}
