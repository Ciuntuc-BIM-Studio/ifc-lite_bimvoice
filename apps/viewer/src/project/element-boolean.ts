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
 * - Union and Intersect are baked into the target and the tools leave the
 *   model, in the same undo step. A target drawn from a 2D contour is
 *   unlinked from it, so a later edit of the contour cannot undo the result.
 */

import { bakeBooleanInStore, removeSubtractionsInStore, resolveJoineryAnchor, subtractElementsInStore } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { setDraftParams } from '@/drafting/draft-store';
import { ensureEditMode } from './edit-mode';
import { deleteInLastStep } from './element-delete';
import { useProjectStore } from './project-store';

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

/** Take back the live subtractions the selected elements take part in. The number of elements re-cut. */
export function removeSubtractionsOfSelection(): number {
  ensureEditMode();
  const picked = booleanSelection(1);
  if (!picked.ok) return 0;
  let count = 0;
  runInspectorEdit(picked.modelId, () => {
    const remesh = recordModellingCommit(useViewerStore, picked.modelId, (editor, ds) => removeSubtractionsInStore(ds, editor, [picked.target, ...picked.tools]));
    count = remesh.length;
    return remesh;
  });
  return count;
}

function globalIdOf(modelId: string, expressId: number): string | null {
  const s = useViewerStore.getState();
  const fresh = s.mutationViews.get(modelId)?.getNewEntity(expressId)?.attributes[0];
  return typeof fresh === 'string' ? fresh : s.models.get(modelId)?.ifcDataStore?.entities.getGlobalId(expressId) || null;
}

/** Bake the tools into the target (UNION or INTERSECTION) and delete them, one undo step. Null, or why it was refused. */
export function bakeSelection(op: 'UNION' | 'INTERSECTION'): { picked: BooleanSelection; error: string | null } {
  ensureEditMode();
  const picked = booleanSelection();
  if (!picked.ok) return { picked, error: null };
  let error: string | null = null;
  const done = runInspectorEdit(picked.modelId, () => {
    const outcome = recordModellingCommit(useViewerStore, picked.modelId, (editor, ds) => bakeBooleanInStore(ds, editor, picked.target, picked.tools, op));
    if (!outcome.ok) { error = outcome.reason; throw new Error(outcome.reason); }
    return outcome.remesh;
  });
  if (!done) return { picked, error: error ?? 'refused' };
  deleteInLastStep(picked.modelId, picked.tools);
  // The result is no longer what its contour would rebuild.
  const guid = globalIdOf(picked.modelId, picked.target);
  const linked = useProjectStore.getState().drafts.filter((d) => d.params.ifcModelId === picked.modelId && d.params.ifcGlobalId === guid);
  if (guid && linked.length) setDraftParams(new Set(linked.map((d) => d.id)), { ifcGlobalId: null, ifcModelId: null, ifcClass: null });
  // The target stays selected; the tools are gone.
  const s = useViewerStore.getState();
  s.setSelectedEntityIds([]);
  s.setSelectedEntityId(toGlobalIdFromModels(s.models, picked.modelId, picked.target));
  return { picked, error: null };
}
