/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Door / Window tools place the catalogue's current entry: registered
 * with `hosted-place.ts`, which stays free of project code. The entry's IFC
 * type is written into the target model the first time (same undo step as
 * the element) and the element is typed by it. With no entry chosen, the
 * element takes the type of its size (`sizedJoinerySpec`, added to the
 * catalogue on first use), so a door or window placed in Lapin is native.
 */

import {
  assignTypeInStore, ensureJoineryTypeInStore, findJoineryTypeInStore, readRelatedLists, resolveJoineryAnchor, sizedJoinerySpec,
  type JoinerySpec,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { registerHostedJoinery, type HostedJoinery } from '@/lib/commands/modeling/commands/hosted-place';
import { currentJoinery, importJoinery, joineryEntry } from './catalog';
import { invalidateJoineryReads } from './element-spec';

const schemaOf = (modelId: string) => String(useViewerStore.getState().models.get(modelId)?.ifcDataStore?.schemaVersion ?? 'IFC4').toUpperCase();

/** `spec` as the tools place it: its IFC type written into the model the first time, the element typed by it. */
function hosted(spec: JoinerySpec, id: string, onMap?: () => void): HostedJoinery {
  return {
    name: spec.name,
    mark: spec.mark,
    width: spec.width,
    height: spec.height,
    ensureMap(modelId, batchId) {
      if (schemaOf(modelId) === 'IFC2X3') throw new Error('Configured door and window types need an IFC4 or IFC4X3 model: untick "Use for placing" to place a plain one');
      onMap?.();
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
}

registerHostedJoinery((kind) => {
  const spec = currentJoinery(kind);
  return spec?.id ? hosted(spec, spec.id) : null;
}, (kind, size, modelId) => {
  // An IFC2X3 model keeps a plain one (its types cannot carry the mapped body).
  if (schemaOf(modelId) === 'IFC2X3') return null;
  const sized = sizedJoinerySpec(kind, size.Width, size.Height, size.Sill);
  const id = sized.id ?? '';
  // The catalogue's entry of that size when there is one (it may have been configured since).
  const known = joineryEntry(id);
  return hosted(known ?? sized, id, known ? undefined : () => importJoinery([sized]));
});
