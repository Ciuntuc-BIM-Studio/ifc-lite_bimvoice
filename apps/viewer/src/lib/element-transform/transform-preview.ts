/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The live move / turn preview (N3, behind `?perf.nativeRemesh=1`): the
 * store core the commit runs (`transformElementsInStore`, joins included) runs
 * on a draft of the model, so the walls joined to a moved one are drawn
 * stretched or shortened as the commit will leave them, with their real
 * geometry. What the native path cannot rebuild (a door, a furnishing) is
 * its drawn mesh, moved or turned, as the plain ghost draws it.
 *
 * Driven from the commands' `ghost`, which sees every change of the op
 * (pointer, typed fields, snaps): a request is made only when the op is new.
 */

import type { ViewerState } from '@/store';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { wallJoinRefusal } from '@/store/slices/mutation-wall-joins';
import { nativeRemeshEnabled } from '@/lib/remesh/native-remesh';
import { endPreview, previewEditNatively, schedulePreview } from '@/lib/remesh/native-preview';
import type { TransformSelection } from '@/lib/commands/modeling/commands/element-transform-shared';
import { renderTransform } from '@/lib/commands/modeling/commands/element-transform-shared';
import type { Vec3 } from '@/lib/commands/modeling/types';
import { transformElementsInStore } from '../../../../../packages/create/src/in-store/element-transform-edit.js';
import { storeyOperation, type ElementTransformOp } from './commit.js';

/** Past this many moving elements the preview stays the plain ghost: rebuilding them all per frame is not live. */
const MAX_PREVIEWED = 200;

let requested: string | null = null;

/** Ask for the preview of `op` on `selection`, once per distinct op; null `op` ends the preview. */
export function previewTransform(commandId: string, s: ViewerState, selection: TransformSelection, op: ElementTransformOp | null, up: Vec3): void {
  if (!op || !nativeRemeshEnabled() || selection.refusal || selection.movedIds.length > MAX_PREVIEWED) {
    requested = null;
    endPreview(); // no op (the base was dropped): the real elements show again
    return;
  }
  const key = `${commandId}|${selection.modelId}|${selection.ids.join(',')}|${JSON.stringify(op)}`;
  if (key === requested) return;
  requested = key;
  const { modelId, ids } = selection;
  if (!modelEditTarget(s, modelId)) return;
  const operation = storeyOperation(s, modelId, op);
  // A model whose joins cannot be edited keeps them as they are, as the commit does.
  const joins = wallJoinRefusal(s, modelId) === null ? {} : { carryJoins: () => [] };
  const apply = renderTransform(op, up);
  schedulePreview(commandId, () => previewEditNatively(modelId, (ctx) => transformElementsInStore({
    dataStore: ctx.dataStore, view: ctx.view, editor: ctx.editor, selected: ids, ...operation, ...joins,
  }).remesh, { ids: selection.movedIds, apply }));
}
