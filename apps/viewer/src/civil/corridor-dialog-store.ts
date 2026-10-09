/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The corridor configurator: which corridor it is on. */

import { create } from 'zustand';
import { useViewerStore } from '@/store';
import { allCorridors, corridorOfRenderId, type CorridorRef } from './corridor-element';

export interface CorridorTarget {
  modelId: string;
  corridorId: number;
}

export const useCorridorDialog = create<{ open: CorridorTarget | null }>()(() => ({ open: null }));

export function openCorridorDialog(target: CorridorTarget): void {
  useCorridorDialog.setState({ open: target });
}

export function closeCorridorDialog(): void {
  useCorridorDialog.setState({ open: null });
}

/** The selected corridor (the block or any of its parts), else the only corridor in the models, else null. */
export function selectedCorridor(): CorridorRef | null {
  const s = useViewerStore.getState();
  const ids = [s.selectedEntityId, ...(s.selectedEntityIds ?? [])].filter((id): id is number => typeof id === 'number');
  for (const id of ids) {
    const target = corridorOfRenderId(id);
    if (target) return target;
  }
  const all = allCorridors();
  return all.length === 1 ? all[0] : null;
}

/** Open the configurator on the selected corridor (or the only one there is); false when there is none to open. */
export function openCorridorForSelection(): boolean {
  const target = selectedCorridor();
  if (!target) return false;
  openCorridorDialog({ modelId: target.modelId, corridorId: target.corridorId });
  return true;
}
