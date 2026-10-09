/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Undo / redo on a drawing tab, where drafting and modelling happen side by
 * side: Undo reverts whichever came last — a drafting step or a model step
 * (a Delete, a wall drawn) in any model — and Redo restores the earliest
 * undone one, so the two histories replay in the order things were done.
 */

import { useViewerStore } from '@/store';
import { lastDraftStepAt, nextDraftRedoAt, redoDrafts, undoDrafts } from '@/drafting/draft-store';

type Stacks = ReadonlyMap<string, readonly { timestamp: number }[]>;

function topOf(stacks: Stacks, pick: (a: number, b: number) => boolean): { modelId: string; at: number } | null {
  let best: { modelId: string; at: number } | null = null;
  for (const [modelId, stack] of stacks) {
    const at = stack.at(-1)?.timestamp;
    if (typeof at === 'number' && (!best || pick(at, best.at))) best = { modelId, at };
  }
  return best;
}

export function undoLatest(): void {
  const s = useViewerStore.getState();
  const model = topOf(s.undoStacks, (a, b) => a > b);
  const draft = lastDraftStepAt();
  if (model && (draft === null || model.at > draft)) s.undo(model.modelId);
  else undoDrafts();
}

export function redoEarliest(): void {
  const s = useViewerStore.getState();
  const model = topOf(s.redoStacks, (a, b) => a < b);
  const draft = nextDraftRedoAt();
  if (model && (draft === null || model.at < draft)) s.redo(model.modelId);
  else redoDrafts();
}
