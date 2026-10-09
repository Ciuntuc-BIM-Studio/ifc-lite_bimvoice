/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Opening a package into the app (a file, a recovery copy or a version):
 * the models and document loaded (`project-open.ts`), the session pointed at
 * what was opened, the recovery copy dropped, and the linked models left to
 * locate (`useLinkedToLocate`, listed by the package host).
 */

import { create } from 'zustand';
import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { projectDocument } from '../project-store';
import type { PackageModel } from './format';
import { openPackageBytes, type ModelLoader } from './project-open';
import { clearRecovery } from './recovery';
import { usePackageSession, versionOf } from './session';

export const useLinkedToLocate = create<{ models: PackageModel[] }>()(() => ({ models: [] }));

/** Open package bytes; true when it opened. */
export async function openProjectBytes(bytes: Uint8Array, source: { fileName: string | null; handle: FileSystemFileHandle | null }, loader: ModelLoader): Promise<boolean> {
  usePackageSession.setState({ busy: 'opening', progress: resolve('projectPackage.opening') });
  try {
    const result = await openPackageBytes(bytes, loader, (label) => usePackageSession.setState({ progress: resolve('projectPackage.openingModel', { name: label }) }));
    usePackageSession.setState({
      projectId: result.opened.manifest.projectId, fileName: source.fileName, handle: source.handle,
      savedAt: Date.parse(result.opened.manifest.savedAt) || null, version: versionOf(result.opened.manifest),
      savedMutationVersion: useViewerStore.getState().mutationVersion, savedDocument: JSON.stringify(projectDocument()),
    });
    await clearRecovery();
    if (result.failed.length) toast.error(resolve('projectPackage.modelsFailed', { names: result.failed.join(', ') }));
    else toast.success(resolve('projectPackage.opened', { name: result.opened.manifest.projectName }));
    useLinkedToLocate.setState({ models: result.linked });
    return true;
  } catch (err) {
    toast.error(resolve('projectPackage.openFailed', { detail: err instanceof Error ? err.message : String(err) }));
    return false;
  } finally {
    usePackageSession.setState({ busy: null, progress: null });
  }
}
