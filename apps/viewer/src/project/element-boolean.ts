/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Studio's boolean operations on the selection (`@ifc-lite/create`'s
 * element-boolean). The element selected first is the target, the others
 * the tools (Shift-click adds them, in order).
 *
 * - Subtract is live: both stay, the cut follows them; "Remove subtraction"
 *   takes it back.
 * - Union and Intersect are live too (`combination-sync.ts`): the tools stay
 *   elements of their own, drawn as part of the target (hidden until "Show
 *   operands"), and the target follows them and its own sketch. "Remove
 *   operation" separates them again.
 */

import { combineElementsInStore, removeSubtractionsInStore, resolveJoineryAnchor, separateCombinationsInStore, subtractElementsInStore } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { ensureEditMode } from './edit-mode';
import { operandsOf, setOperandsShown, withoutFollowing } from './combination-sync';

export type BooleanSelection =
  | { ok: true; modelId: string; target: number; tools: number[] }
  | { ok: false; error: 'select' | 'models' };

/** The selection as target (first selected) and tools, all in one model. */
export function booleanSelection(minimum = 2): BooleanSelection {
  const s = useViewerStore.getState();
  const ids = [...s.selectedEntityIds];
  if (s.selectedEntityId !== null && !ids.includes(s.selectedEntityId)) ids.push(s.selectedEntityId);
  if (ids.length < minimum) return { ok: false, error: 'select' };
  const refs = ids.map((id) => s.resolveGlobalIdFromModels(id));
  if (refs.some((r) => !r) || new Set(refs.map((r) => r!.modelId)).size !== 1) return { ok: false, error: 'models' };
  const [target, ...tools] = refs.map((r) => r!.expressId);
  return { ok: true, modelId: refs[0]!.modelId, target, tools };
}

/** Take the tools out of the target, live. One undo step. */
export function subtractSelection(): BooleanSelection {
  ensureEditMode();
  const picked = booleanSelection();
  if (!picked.ok) return picked;
  runInspectorEdit(picked.modelId, () => recordModellingCommit(useViewerStore, picked.modelId, (editor, ds) =>
    subtractElementsInStore(ds, editor, resolveJoineryAnchor(ds, editor.getMutationView()), picked.target, picked.tools)));
  return picked;
}

/** Take back the live subtractions and combinations the selected elements take part in. The number of elements re-cut. */
export function removeSubtractionsOfSelection(): number {
  ensureEditMode();
  const picked = booleanSelection(1);
  if (!picked.ok) return 0;
  const ids = [picked.target, ...picked.tools];
  let count = 0;
  let freed: number[] = [];
  withoutFollowing(() => runInspectorEdit(picked.modelId, () => {
    const remesh = recordModellingCommit(useViewerStore, picked.modelId, (editor, ds) => {
      const tools = operandsOf(picked.modelId, ids).concat(ids);
      const combined = separateCombinationsInStore(ds, editor, ids);
      freed = combined.filter((id) => tools.includes(id));
      return [...new Set([...removeSubtractionsInStore(ds, editor, ids), ...combined])];
    });
    count = remesh.length;
    return remesh;
  }));
  // The tools set free are drawn again.
  setOperandsShown(picked.modelId, freed, true);
  return count;
}

/** Show the selected combined elements' tools for editing, or hide them again. Their number. */
export function toggleOperandsOfSelection(): number {
  const picked = booleanSelection(1);
  if (!picked.ok) return 0;
  const tools = operandsOf(picked.modelId, [picked.target, ...picked.tools]);
  if (!tools.length) return 0;
  const s = useViewerStore.getState();
  const hidden = tools.some((t) => s.hiddenEntities.has(toGlobalIdFromModels(s.models, picked.modelId, t)));
  setOperandsShown(picked.modelId, tools, hidden);
  return tools.length;
}

/** Combine the tools into the target (UNION or INTERSECTION), live: one undo step. Null, or why it was refused. */
export function bakeSelection(op: 'UNION' | 'INTERSECTION'): { picked: BooleanSelection; error: string | null } {
  ensureEditMode();
  const picked = booleanSelection();
  if (!picked.ok) return { picked, error: null };
  let error: string | null = null;
  const done = withoutFollowing(() => runInspectorEdit(picked.modelId, () => {
    const outcome = recordModellingCommit(useViewerStore, picked.modelId, (editor, ds) =>
      combineElementsInStore(ds, editor, resolveJoineryAnchor(ds, editor.getMutationView()), picked.target, picked.tools, op));
    if (!outcome.ok) { error = outcome.reason; throw new Error(outcome.reason); }
    return outcome.remesh;
  }));
  if (!done) return { picked, error: error ?? 'refused' };
  // The tools are drawn as part of the target; the target stays selected.
  setOperandsShown(picked.modelId, picked.tools, false);
  const s = useViewerStore.getState();
  s.setSelectedEntityIds([]);
  s.setSelectedEntityId(toGlobalIdFromModels(s.models, picked.modelId, picked.target));
  return { picked, error: null };
}
