/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Making and placing road drawings: a profile or section set of the
 * selected (or only) corridor, opened in its tab; and "Draw on plan", which
 * opens the corridor's floor plan and starts CIVILDWG to pick where the
 * drawing goes, Civil 3D style.
 */

import { resolve } from '@/i18n/registry';
import { toast } from '@/components/ui/toast';
import { useProjectStore } from '@/project/project-store';
import { activateDocumentTab } from '@/project/open-view';
import { startDraftCommand } from '@/drafting/session';
import { useViewerStore } from '@/store';
import { selectedCorridor } from './corridor-dialog-store';
import { addCivilDrawing, civilDrawing, drawingCorridor } from './civil-drawings';

let pending: string | null = null;

/** The drawing CIVILDWG places next (then forgotten). */
export function takePendingCivilDrawing(): string | null {
  const id = pending;
  return id;
}

export function clearPendingCivilDrawing(): void {
  pending = null;
}

/** A new profile / section set of the selected (or only) corridor, opened. */
export function newCivilDrawing(kind: 'profile' | 'sections'): boolean {
  const ref = selectedCorridor();
  if (!ref) {
    toast.info(resolve('civil.noSelection'));
    return false;
  }
  const id = addCivilDrawing(ref, kind);
  activateDocumentTab(id);
  return true;
}

/** Open the floor plan the drawing's corridor is on and pick where to draw it. */
export function drawCivilOnPlan(drawingId: string): boolean {
  const d = civilDrawing(drawingId);
  const ref = d ? drawingCorridor(d) : null;
  if (!d || !ref) {
    toast.error(resolve('civilDwg.noCorridor'));
    return false;
  }
  const s = useViewerStore.getState();
  const ds = s.models.get(ref.modelId)?.ifcDataStore;
  const storeyId = ds?.spatialHierarchy?.elementToStorey.get(ref.corridorId);
  const storeyGuid = storeyId === undefined ? null : ds?.entities.getGlobalId(storeyId) ?? null;
  const plan = useProjectStore.getState().views.find((v) => v.kind === 'plan' && (!storeyGuid || v.level.storeyGlobalIds.includes(storeyGuid)));
  if (!plan) {
    toast.info(resolve('civilDwg.noPlan'));
    return false;
  }
  pending = drawingId;
  activateDocumentTab(plan.id);
  // The plan's drafting session attaches as its tab mounts.
  setTimeout(() => startDraftCommand('civildwg'), 0);
  return true;
}
