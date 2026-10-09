/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Model groups in the viewer (`@ifc-lite/create`'s element-group), Revit /
 * Blender style:
 *
 * - Group makes the selection one IfcGroup; clicking any member then selects
 *   the whole group ("Select groups", on by default), so Move, Copy, Flip…
 *   act on it together;
 * - Edit group enters the group's edit mode: everything else turns X-ray and
 *   cannot be selected, so only the group is worked on; what is built while
 *   editing joins the group; Add / Remove take picked elements in or out;
 *   Finish leaves the mode.
 *
 * Every change is one undo step. Ids here are renderer (global) ids unless
 * named `expressId`.
 */

import { create } from 'zustand';
import {
  addToGroupInStore, createGroupInStore, groupableElements, modelGroups, removeFromGroupInStore, renameGroupInStore, resolveAuthoringAnchor, ungroupInStore, type ModelGroup,
} from '@ifc-lite/create';
import type { StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureEditMode } from './edit-mode';

export interface GroupRef {
  modelId: string;
  groupId: number;
  name: string;
  /** Members, express ids. */
  members: number[];
}

export type GroupPicking = 'add' | 'remove' | null;

export const useGroupEdit = create<{ editing: { modelId: string; groupId: number; name: string } | null; picking: GroupPicking }>()(() => ({ editing: null, picking: null }));
export const useGroupPrefs = create<{ selectGroups: boolean }>()(() => ({ selectGroups: true }));

// --- reading ---------------------------------------------------------------

let index: { version: number; models: unknown; byModel: Map<string, { groups: ModelGroup[]; byMember: Map<number, ModelGroup> }> } | null = null;

function groupIndex() {
  const s = useViewerStore.getState();
  if (index && index.version === s.mutationVersion && index.models === s.models) return index.byModel;
  const byModel = new Map<string, { groups: ModelGroup[]; byMember: Map<number, ModelGroup> }>();
  for (const [modelId, model] of s.models) {
    if (!model.ifcDataStore) continue;
    let groups: ModelGroup[] = [];
    try {
      groups = modelGroups(model.ifcDataStore, s.mutationViews.get(modelId) ?? null);
    } catch {
      groups = [];
    }
    const byMember = new Map<number, ModelGroup>();
    for (const g of groups) for (const m of g.members) byMember.set(m, g);
    byModel.set(modelId, { groups, byMember });
  }
  index = { version: s.mutationVersion, models: s.models, byModel };
  return byModel;
}

const toRef = (modelId: string, g: ModelGroup): GroupRef => ({ modelId, groupId: g.id, name: g.name, members: g.members });

/** The group a renderer id belongs to, or null. */
export function groupOfRenderId(renderId: number): GroupRef | null {
  const ref = useViewerStore.getState().resolveGlobalIdFromModels(renderId);
  const g = ref ? groupIndex().get(ref.modelId)?.byMember.get(ref.expressId) : undefined;
  return ref && g ? toRef(ref.modelId, g) : null;
}

/** A group by id (fresh members), or null when it is gone. */
export function groupById(modelId: string, groupId: number): GroupRef | null {
  const g = groupIndex().get(modelId)?.groups.find((x) => x.id === groupId);
  return g ? toRef(modelId, g) : null;
}

/** Every model group of every loaded model. */
export function allGroups(): GroupRef[] {
  return [...groupIndex()].flatMap(([modelId, m]) => m.groups.map((g) => toRef(modelId, g)));
}

const renderIds = (modelId: string, ids: readonly number[]) => {
  const models = useViewerStore.getState().models;
  return ids.map((id) => toGlobalIdFromModels(models, modelId, id));
};

function selection(): number[] {
  const s = useViewerStore.getState();
  const ids = new Set(s.selectedEntityIds);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  return [...ids];
}

/** The selection by model, express ids. */
function selectionByModel(): Map<string, number[]> {
  const s = useViewerStore.getState();
  const out = new Map<string, number[]>();
  for (const id of selection()) {
    const ref = s.resolveGlobalIdFromModels(id);
    if (ref) out.set(ref.modelId, [...(out.get(ref.modelId) ?? []), ref.expressId]);
  }
  return out;
}

function commit<T>(modelId: string, run: (editor: StoreEditor, ds: IfcDataStore) => T): T {
  return recordModellingCommit(useViewerStore, modelId, run);
}

const anchorOf = (ds: IfcDataStore, editor: StoreEditor) => resolveAuthoringAnchor(ds, editor.getMutationView());

// --- actions ---------------------------------------------------------------

export type GroupOutcome = { ok: true; group?: GroupRef; count?: number } | { ok: false; error: GroupError };
export type GroupError = 'nothingSelected' | 'twoModels' | 'notElements' | 'noGroup' | 'failed';

/** Make the selected elements one group (taken out of the groups they were in), then select it. */
export function groupSelection(name?: string): GroupOutcome {
  const byModel = selectionByModel();
  if (byModel.size === 0) return { ok: false, error: 'nothingSelected' };
  if (byModel.size > 1) return { ok: false, error: 'twoModels' };
  ensureEditMode();
  const [[modelId, ids]] = [...byModel];
  const s = useViewerStore.getState();
  const ds = s.models.get(modelId)?.ifcDataStore;
  if (!ds) return { ok: false, error: 'failed' };
  const label = name?.trim() || `Group ${allGroups().filter((g) => g.modelId === modelId).length + 1}`;
  try {
    const made = commit(modelId, (editor, store) => {
      const anchor = anchorOf(store, editor);
      const members = groupableElements(store, ids, editor.getMutationView(), anchor.schema);
      if (members.length === 0) return null;
      return createGroupInStore(store, editor, anchor, label, members);
    });
    if (!made) return { ok: false, error: 'notElements' };
    const group = { modelId, groupId: made.groupId, name: label, members: made.members };
    selectGroup(group);
    return { ok: true, group };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** Dissolve the groups of the selected elements. */
export function ungroupSelection(): GroupOutcome {
  const groups = new Map<string, GroupRef>();
  for (const id of selection()) {
    const g = groupOfRenderId(id);
    if (g) groups.set(`${g.modelId}:${g.groupId}`, g);
  }
  if (groups.size === 0) return { ok: false, error: 'noGroup' };
  ensureEditMode();
  try {
    for (const g of groups.values()) {
      if (useGroupEdit.getState().editing?.groupId === g.groupId) finishGroupEdit();
      commit(g.modelId, (editor, store) => ungroupInStore(store, editor, g.groupId));
    }
    return { ok: true, count: groups.size };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

export function renameGroup(ref: Pick<GroupRef, 'modelId' | 'groupId'>, name: string): boolean {
  if (!name.trim()) return false;
  ensureEditMode();
  try {
    commit(ref.modelId, (editor) => renameGroupInStore(editor, ref.groupId, name.trim()));
    const editing = useGroupEdit.getState().editing;
    if (editing?.groupId === ref.groupId && editing.modelId === ref.modelId) useGroupEdit.setState({ editing: { ...editing, name: name.trim() } });
    return true;
  } catch {
    return false;
  }
}

/** Select every member of a group (the clicked one last, so it stays the inspected one). */
export function selectGroup(group: GroupRef, last?: number): void {
  const ids = renderIds(group.modelId, group.members).filter((id) => id !== last);
  withSelectionGuard(() => useViewerStore.getState().setSelectedEntityIds(last === undefined ? ids : [...ids, last]));
}

// --- edit mode -------------------------------------------------------------

function ghostTo(group: GroupRef | null): void {
  const s = useViewerStore.getState();
  s.setGhostExceptEntities(group ? new Set(renderIds(group.modelId, group.members)) : null);
}

/** Enter a group's edit mode: the rest of the model turns X-ray and cannot be picked. */
export function startGroupEdit(group: GroupRef): void {
  ensureEditMode();
  useGroupEdit.setState({ editing: { modelId: group.modelId, groupId: group.groupId, name: group.name }, picking: null });
  knownCreated = createdSnapshot(group.modelId);
  ghostTo(group);
  withSelectionGuard(() => useViewerStore.getState().setSelectedEntityIds([]));
}

/** Edit the group of the selection; false when nothing selected is in a group. */
export function editSelectedGroup(): boolean {
  for (const id of selection()) {
    const g = groupOfRenderId(id);
    if (g) {
      startGroupEdit(g);
      return true;
    }
  }
  return false;
}

export function finishGroupEdit(): void {
  if (!useGroupEdit.getState().editing) return;
  useGroupEdit.setState({ editing: null, picking: null });
  knownCreated = new Set();
  ghostTo(null);
}

export function setGroupPicking(picking: GroupPicking): void {
  useGroupEdit.setState({ picking: useGroupEdit.getState().picking === picking ? null : picking });
}

function editedGroup(): GroupRef | null {
  const e = useGroupEdit.getState().editing;
  return e ? groupById(e.modelId, e.groupId) : null;
}

function changeMembers(kind: 'add' | 'remove', expressIds: number[]): void {
  const e = useGroupEdit.getState().editing;
  if (!e || expressIds.length === 0) return;
  try {
    const left = commit(e.modelId, (editor, store) => {
      if (kind === 'remove') return removeFromGroupInStore(store, editor, e.groupId, expressIds).groupRemoved ? null : true;
      const anchor = anchorOf(store, editor);
      const fresh = groupableElements(store, expressIds, editor.getMutationView(), anchor.schema);
      if (fresh.length) addToGroupInStore(store, editor, anchor, e.groupId, fresh);
      return true;
    });
    if (left === null) {
      finishGroupEdit();
      return;
    }
  } catch (err) {
    console.warn('[groups] could not change the group', err);
  }
  ghostTo(editedGroup());
}

// --- behaviour: selection follows groups, edit mode filters it -----------------

let guard = false;
function withSelectionGuard(run: () => void): void {
  guard = true;
  try { run(); } finally { guard = false; prevSelection = new Set(selection()); }
}

let prevSelection = new Set<number>();
let knownCreated = new Set<number>();

function createdSnapshot(modelId: string): Set<number> {
  const view = useViewerStore.getState().mutationViews.get(modelId);
  return new Set(view?.getNewEntities().map((e) => e.expressId) ?? []);
}

function onSelection(): void {
  const now = new Set(selection());
  const added = [...now].filter((id) => !prevSelection.has(id));
  const removed = [...prevSelection].filter((id) => !now.has(id));
  prevSelection = now;
  const editing = useGroupEdit.getState().editing;
  const s = useViewerStore.getState();
  if (editing) {
    const group = editedGroup();
    const members = new Set(group ? renderIds(group.modelId, group.members) : []);
    const picking = useGroupEdit.getState().picking;
    const own = (id: number) => s.resolveGlobalIdFromModels(id)?.modelId === editing.modelId;
    if (picking === 'add') {
      const outside = added.filter((id) => !members.has(id) && own(id));
      if (outside.length) changeMembers('add', outside.map((id) => s.resolveGlobalIdFromModels(id)!.expressId));
      return;
    }
    if (picking === 'remove') {
      const inside = added.filter((id) => members.has(id));
      if (inside.length) changeMembers('remove', inside.map((id) => s.resolveGlobalIdFromModels(id)!.expressId));
      withSelectionGuard(() => s.setSelectedEntityIds([]));
      return;
    }
    // Only the group can be worked on.
    if ([...now].some((id) => !members.has(id))) {
      const kept = [...now].filter((id) => members.has(id));
      withSelectionGuard(() => s.setSelectedEntityIds(kept));
    }
    return;
  }
  if (!useGroupPrefs.getState().selectGroups) return;
  const want = new Set(now);
  let last: number | undefined = s.selectedEntityId ?? undefined;
  for (const id of added) {
    const g = groupOfRenderId(id);
    if (g) for (const m of renderIds(g.modelId, g.members)) want.add(m);
  }
  for (const id of removed) {
    const g = groupOfRenderId(id);
    if (!g) continue;
    const ids = renderIds(g.modelId, g.members);
    // One member let go of: the whole group goes (unless it was all cleared anyway).
    if (ids.some((m) => now.has(m))) ids.forEach((m) => want.delete(m));
    if (last !== undefined && !want.has(last)) last = undefined;
  }
  if (want.size === now.size && [...want].every((id) => now.has(id))) return;
  withSelectionGuard(() => {
    const ids = [...want].filter((id) => id !== last);
    s.setSelectedEntityIds(last === undefined ? ids : [...ids, last]);
  });
}

/** While a group is edited, what gets built joins it. */
function onModelChange(): void {
  const editing = useGroupEdit.getState().editing;
  if (!editing) return;
  const now = createdSnapshot(editing.modelId);
  const fresh = [...now].filter((id) => !knownCreated.has(id));
  knownCreated = now;
  if (fresh.length === 0) return;
  const s = useViewerStore.getState();
  const ds = s.models.get(editing.modelId)?.ifcDataStore;
  const view = s.mutationViews.get(editing.modelId) ?? null;
  if (!ds) return;
  let elements: number[] = [];
  try {
    elements = groupableElements(ds, fresh, view, resolveAuthoringAnchor(ds, view).schema)
      .filter((id) => s.models.get(editing.modelId)?.ifcDataStore?.spatialHierarchy?.elementToStorey.has(id) ?? true);
  } catch {
    elements = [];
  }
  const group = editedGroup();
  const missing = elements.filter((id) => !group?.members.includes(id));
  if (missing.length) {
    // After the command's own commit has settled.
    queueMicrotask(() => {
      changeMembers('add', missing);
      knownCreated = createdSnapshot(editing.modelId);
    });
  }
}

let installed = false;
/** Wire the behaviour once (imported by the navigator). */
export function installGroupBehaviour(): void {
  if (installed) return;
  installed = true;
  useViewerStore.subscribe((s, p) => {
    if (s.mutationVersion !== p.mutationVersion) onModelChange();
    if (guard) return;
    if (s.selectionRevision !== p.selectionRevision || s.selectedEntityId !== p.selectedEntityId || s.selectedEntityIds !== p.selectedEntityIds) onSelection();
  });
}
