/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Save and Save as for the open project: package it, write it where it was
 * opened from or last saved (asking where on a Save as, or the first time),
 * remember what was saved, drop the recovery copy. A version stamps the
 * package with its version info first. Progress shows through the session.
 */

import { useViewerStore } from '@/store';
import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { sanitizeFilename } from '@/lib/export/download';
import { projectDocument, useProjectStore } from '../project-store';
import { canWriteInPlace, downloadPackage, pickSaveTarget, writeToHandle } from './file-access';
import { PACKAGE_SUFFIX, type PackageVersionInfo } from './format';
import { packageCurrentProject, type PackagedProject } from './project-save';
import { clearRecovery } from './recovery';
import { newProjectId, usePackageSession } from './session';

let busy = false;

/** Save the open project (as: ask where); the package written, or null when cancelled or failed (the reason shown). */
export async function saveProject(as: boolean, versionInfo?: PackageVersionInfo, options: { analytics?: boolean } = {}): Promise<PackagedProject | null> {
  if (busy) return null;
  if (useViewerStore.getState().models.size === 0) { toast.info(resolve('projectPackage.nothingToSave')); return null; }
  busy = true;
  const session = usePackageSession.getState();
  try {
    const name = sanitizeFilename(useProjectStore.getState().name || 'project', { fallback: 'project' });
    let handle = as ? null : session.handle;
    if (!handle && canWriteInPlace()) {
      handle = await pickSaveTarget(session.fileName ?? `${name}${PACKAGE_SUFFIX}`);
      if (!handle) return null;
    }
    const projectId = session.projectId ?? newProjectId();
    usePackageSession.setState({ busy: 'saving', progress: resolve('projectPackage.saving') });
    try {
      const packaged = await packageCurrentProject(projectId, {
        versionInfo, analytics: options.analytics, onProgress: (label) => usePackageSession.setState({ progress: resolve('projectPackage.savingModel', { name: label }) }),
      });
      const fileName = handle?.name ?? session.fileName ?? `${name}${PACKAGE_SUFFIX}`;
      if (handle) await writeToHandle(handle, packaged.bytes);
      else downloadPackage(packaged.bytes, fileName);
      usePackageSession.setState({
        projectId, fileName, handle, savedAt: Date.now(),
        savedMutationVersion: useViewerStore.getState().mutationVersion, savedDocument: JSON.stringify(projectDocument()),
      });
      await clearRecovery();
      toast.success(resolve('projectPackage.saved', { name: fileName, mb: (packaged.bytes.byteLength / 1e6).toFixed(1) }));
      return packaged;
    } catch (err) {
      toast.error(resolve('projectPackage.saveFailed', { detail: err instanceof Error ? err.message : String(err) }));
      return null;
    }
  } finally {
    usePackageSession.setState({ busy: null, progress: null });
    busy = false;
  }
}
