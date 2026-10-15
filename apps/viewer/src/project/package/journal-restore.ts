/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bring a journalled session back (`journal.ts`): everything open is closed,
 * each model is loaded from the source it was loaded from, the project
 * document is put back, then each model's overlay, undo / redo history and
 * history metadata are restored, the elements it created are listed in the
 * spatial tree again, what it deleted leaves the scene and what it
 * re-shaped is re-meshed. The project stays unsaved.
 */

import { loadProjectDocument, resetProject } from '../project-store';
import type { ModelLoader } from './project-open';
import { readJournalSource, type JournalEntry, type JournalModel } from './journal';
import { restoreModelDelta } from './model-delta';

/** Restore `entry`; the names of the models whose source could not be loaded. */
export async function restoreJournal(entry: JournalEntry, loader: ModelLoader): Promise<string[]> {
  loader.clearAll();
  resetProject();
  const failed: string[] = [];
  const loaded: Array<{ model: JournalModel; id: string }> = [];
  for (const model of entry.models) {
    const blob = await readJournalSource(model.sessionId);
    const id = blob ? await loader.addModel(new File([blob], model.name || `${model.sessionId}.ifc`), { name: model.name }) : null;
    if (id) loaded.push({ model, id });
    else failed.push(model.name);
  }
  loadProjectDocument(entry.doc, { dirty: true });
  for (const { model, id } of loaded) restoreModelDelta(model, id, model);
  return failed;
}
