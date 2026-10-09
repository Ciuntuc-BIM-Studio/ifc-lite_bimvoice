/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Opening a project package: everything loaded is closed, the native models
 * are loaded from their IFC in the package (one after another, as federated
 * models), and only then the project document is put in place — its views,
 * sheets, drafts and settings now refer to models that are there. Linked
 * models are reported back for the user to locate; loaded later with
 * `loadLinkedModel`, they are read-only.
 */

import { useViewerStore } from '@/store';
import { loadProjectDocument, resetProject } from '../project-store';
import type { PackageModel } from './format';
import { readPackage, unzipPackage, type OpenedPackage } from './package-io';

export interface ModelLoader {
  /** Close every loaded model (and reset the viewer). */
  clearAll: () => void;
  /** Load one model as a federated model; its id, or null when it did not load. */
  addModel: (file: File, options: { name: string }) => Promise<string | null>;
}

export interface OpenResult {
  opened: OpenedPackage;
  /** Native models that did not load. */
  failed: string[];
  /** Linked models to locate. */
  linked: PackageModel[];
}

export async function openPackageBytes(bytes: Uint8Array, loader: ModelLoader, onProgress?: (label: string) => void): Promise<OpenResult> {
  // Read and check everything before closing what is open: a bad file leaves the session as it was.
  const opened = await readPackage(unzipPackage(bytes));
  loader.clearAll();
  resetProject();
  const failed: string[] = [];
  for (const { model, bytes: ifc } of opened.models) {
    if (model.role !== 'native' || !ifc) continue;
    onProgress?.(model.name);
    const name = model.name || `${model.id}.ifc`;
    const id = await loader.addModel(new File([ifc as BlobPart], name), { name });
    if (!id) failed.push(model.name);
  }
  loadProjectDocument(opened.doc);
  return { opened, failed, linked: opened.models.filter((m) => m.model.role === 'linked').map((m) => m.model) };
}

/** Load a coordination model read-only. */
export async function loadLinkedModel(file: File, loader: Pick<ModelLoader, 'addModel'>): Promise<string | null> {
  const id = await loader.addModel(file, { name: file.name });
  if (id) useViewerStore.getState().updateModel(id, { linked: true });
  return id;
}
