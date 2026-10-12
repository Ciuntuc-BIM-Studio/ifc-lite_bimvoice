/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Door / Window tools place the catalogue's current entry: registered
 * with `hosted-place.ts`, which stays free of project code. The entry's IFC
 * type is written into the target model the first time (same undo step as
 * the element) and the element is typed by it.
 */

import {
  assignTypeInStore, ensureJoineryTypeInStore, findJoineryTypeInStore, readRelatedLists, resolveJoineryAnchor,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { registerHostedJoinery } from '@/lib/commands/modeling/commands/hosted-place';
import { currentJoinery } from './catalog';
import { invalidateJoineryReads } from './element-spec';

registerHostedJoinery((kind) => {
  const spec = currentJoinery(kind);
  if (!spec?.id) return null;
  const id = spec.id;
  return {
    name: spec.name,
    mark: spec.mark,
    width: spec.width,
    height: spec.height,
    ensureMap(modelId, batchId) {
      const schema = String(useViewerStore.getState().models.get(modelId)?.ifcDataStore?.schemaVersion ?? 'IFC4').toUpperCase();
      if (schema === 'IFC2X3') throw new Error('Configured door and window types need an IFC4 or IFC4X3 model: pick "No type" to place a plain one');
      return recordModellingCommit(useViewerStore, modelId, (editor, ds) => ensureJoineryTypeInStore(ds, editor, spec).mapId, batchId);
    },
    assign(modelId, expressId, batchId) {
      recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
        const view = editor.getMutationView();
        const type = findJoineryTypeInStore(ds, id, view);
        if (!type) return;
        assignTypeInStore(editor, resolveJoineryAnchor(ds, view), type.typeId, [expressId], readRelatedLists(ds, 'IfcRelDefinesByType', view));
      }, batchId);
      invalidateJoineryReads(modelId);
    },
  };
});
