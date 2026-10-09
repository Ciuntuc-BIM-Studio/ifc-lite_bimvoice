/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The open project as a package: the project document, every native model
 * as a complete IFC with all its edits (the same export as "Export modified
 * IFC"; an unedited model is written from its source bytes, at no cost) and
 * the linked models as references. A native model's key in the document
 * becomes the identity of the bytes written, which is what the loader
 * computes when the package is opened again.
 */

import { asSourceBytes, type IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { collectChangedModels } from '@/lib/export/model-changes';
import { exportChangedModelToStep } from '@/lib/export/changed-model-export';
import { mapStepSchema } from '@/lib/export/artifact-naming';
import { placementSourceIdentity } from '@/lib/model-placement/source-identity';
import { projectDocument } from '../project-store';
import { modelRef } from '../project-sync';
import type { ProjectDocument } from '../types';
import { buildPackage, zipPackage, type ModelInput } from './package-io';
import type { PackageManifest, PackageVersionInfo } from './format';

const APP = { name: 'BIMVoice', version: '4.0.0' };

async function nativeModelBytes(modelId: string, dataStore: IfcDataStore, edited: boolean): Promise<Uint8Array> {
  const source = dataStore.source ? asSourceBytes(dataStore.source) : null;
  // A copy: the parsed source can sit in shared memory, which Blob and Web Crypto refuse.
  if (!edited && source && source.byteLength > 0) return new Uint8Array(source.materialize());
  const state = useViewerStore.getState();
  const artifact = await exportChangedModelToStep(modelId, dataStore, state.mutationViews.get(modelId), {
    schema: mapStepSchema(String(dataStore.schemaVersion ?? 'IFC4')),
    georefMutations: state.georefMutations.get(modelId),
    scheduleState: null,
    description: 'BIMVoice project',
  });
  return typeof artifact.content === 'string' ? new TextEncoder().encode(artifact.content) : artifact.content;
}

export interface PackagedProject {
  bytes: Uint8Array;
  manifest: PackageManifest;
  /** The document as saved (native model keys moved to the saved bytes' identity). */
  doc: ProjectDocument;
}

export async function packageCurrentProject(projectId: string, options: { versionInfo?: PackageVersionInfo; onProgress?: (label: string) => void } = {}): Promise<PackagedProject> {
  const state = useViewerStore.getState();
  const edited = new Set(collectChangedModels(state).models.map((m) => m.id));
  const doc = projectDocument();
  const renamed = new Map<string, string>();
  const models: ModelInput[] = [];
  for (const model of state.models.values()) {
    if (!model.ifcDataStore) continue;
    const ref = modelRef(model);
    if (model.linked) {
      models.push({ id: ref.key, name: model.name, role: 'linked', source: model.name, ...(model.sourceContentHash ? { sha256: model.sourceContentHash } : {}) });
      continue;
    }
    options.onProgress?.(model.name);
    const bytes = await nativeModelBytes(model.id, model.ifcDataStore, edited.has(model.id));
    const key = (await placementSourceIdentity(new Blob([bytes as BlobPart]), undefined, bytes)) ?? ref.key;
    renamed.set(ref.key, key);
    models.push({ id: key, name: model.name, role: 'native', bytes });
  }
  const saved: ProjectDocument = { ...doc, models: models.map((m) => ({ key: m.id, name: m.name })) };
  // Keep a reference the document had to a model not loaded right now.
  for (const ref of doc.models) if (!renamed.has(ref.key) && !saved.models.some((m) => m.key === ref.key)) saved.models.push(ref);
  const { files, manifest } = await buildPackage({ projectId, doc: saved, models, app: APP, versionInfo: options.versionInfo });
  return { bytes: zipPackage(files), manifest, doc: saved };
}
