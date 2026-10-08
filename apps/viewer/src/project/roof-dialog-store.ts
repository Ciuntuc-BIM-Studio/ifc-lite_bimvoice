/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The roof configurator and the roof's in-place edit mode: which roof system
 * each is on. In edit mode the plan shows a chip per edge (eave / gable,
 * pitch, overhang) to change on the canvas, and 3D isolates the roof.
 */

import { create } from 'zustand';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import type { RoofSystemRef } from './roof-system-element';

export interface RoofTarget {
  modelId: string;
  roofId: number;
}

export const useRoofDialog = create<{ open: RoofTarget | null; editing: RoofTarget | null }>()(() => ({ open: null, editing: null }));

export function openRoofDialog(target: RoofTarget): void {
  useRoofDialog.setState({ open: target });
}

export function closeRoofDialog(): void {
  useRoofDialog.setState({ open: null });
}

/** Enter the roof's edit mode: everything else fades away in 3D. */
export function startRoofEdit(ref: RoofSystemRef, partIds: readonly number[]): void {
  useRoofDialog.setState({ open: null, editing: { modelId: ref.modelId, roofId: ref.roofId } });
  const s = useViewerStore.getState();
  const ids = [ref.roofId, ...partIds].map((id) => toGlobalIdFromModels(s.models, ref.modelId, id));
  s.isolateEntities(ids);
}

export function stopRoofEdit(): void {
  if (!useRoofDialog.getState().editing) return;
  useRoofDialog.setState({ editing: null });
  useViewerStore.getState().setIsolatedEntities(null);
}

/** Open the configurator on the selected roof system (any of its planes or members); false when none is selected. */
export function openRoofForSelection(roofOf: (renderId: number) => RoofTarget | null): boolean {
  const s = useViewerStore.getState();
  const ids = [s.selectedEntityId, ...(s.selectedEntityIds ?? [])].filter((id): id is number => typeof id === 'number');
  for (const id of ids) {
    const target = roofOf(id);
    if (target) {
      openRoofDialog({ modelId: target.modelId, roofId: target.roofId });
      return true;
    }
  }
  return false;
}
