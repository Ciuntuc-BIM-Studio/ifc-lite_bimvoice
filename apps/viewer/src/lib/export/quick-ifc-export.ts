/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * File › Export IFC: the active model (else the first) as IFC, in one click,
 * as the Export dialog's single-model STEP export writes it with its
 * defaults — every element, the edits applied, the native elements' base
 * quantities and parameters, a live Union's tools left to their target.
 */

import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { exportModelStep } from './model-step-export';
import { withNativeExportSets } from './native-export-sets';
import { packagePortableIfcAsync } from './portable-ifc';
import { downloadFile, modelExportFilename } from './download';
import { mapStepSchema } from './artifact-naming';

let running = false;

export async function exportActiveModelIfc(): Promise<void> {
  if (running) return;
  const state = useViewerStore.getState();
  const modelId = state.activeModelId && state.models.has(state.activeModelId) ? state.activeModelId : [...state.models.keys()][0];
  const model = modelId ? state.models.get(modelId) : undefined;
  const dataStore = model?.ifcDataStore;
  if (!modelId || !model || !dataStore) {
    toast.info(resolve('projectPackage.exportIfcNone'));
    return;
  }
  running = true;
  toast.info(resolve('projectPackage.exportIfcRunning', { name: model.name }));
  try {
    const view = state.mutationViews.get(modelId);
    const result = await exportModelStep({
      modelId,
      dataStore,
      mutationView: view ? withNativeExportSets(dataStore, view) : undefined,
      options: {
        schema: mapStepSchema(String(dataStore.schemaVersion ?? 'IFC4')),
        includeGeometry: true,
        applyMutations: true,
        visibleOnly: false,
        georefMutations: state.georefMutations?.get(modelId) ?? undefined,
        application: 'ifc-lite',
      },
      scheduleState: null,
    });
    const artifact = await packagePortableIfcAsync(modelId, result.content, result.resources);
    downloadFile(artifact.content, modelExportFilename(model.name, artifact.ext, '_export'), artifact.mime);
    toast.success(resolve('projectPackage.exportIfcDone', { name: model.name, count: result.stats.entityCount.toLocaleString('en-US') }));
  } catch (error) {
    console.error('[export] IFC export failed', error);
    toast.error(resolve('projectPackage.exportIfcFailed', { reason: error instanceof Error ? error.message : String(error) }));
  } finally {
    running = false;
  }
}
