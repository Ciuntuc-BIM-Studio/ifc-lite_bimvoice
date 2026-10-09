/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The recovery copy: after a change to the models or the project document,
 * once the user has paused (IDLE_MS) and at most every MIN_INTERVAL_MS, the
 * open project is packaged and written to the browser's storage — only while
 * it differs from what was last saved or opened. Packaging exports the
 * edited native models, so it is kept off the editing hot path.
 */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';
import { projectDocument, useProjectStore } from '@/project/project-store';
import { packageCurrentProject } from '@/project/package/project-save';
import { writeRecovery } from '@/project/package/recovery';
import { newProjectId, usePackageSession } from '@/project/package/session';

const IDLE_MS = 8_000;
const MIN_INTERVAL_MS = 60_000;

/** Whether the open project differs from what was last saved or opened. */
export function isProjectDirty(): boolean {
  const viewer = useViewerStore.getState();
  if (viewer.models.size === 0) return false;
  const session = usePackageSession.getState();
  if (session.savedMutationVersion === null) return true;
  return viewer.mutationVersion !== session.savedMutationVersion || JSON.stringify(projectDocument()) !== session.savedDocument;
}

export function useAutosaveRecovery(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    let running = false;
    const run = async () => {
      timer = null;
      if (running || usePackageSession.getState().busy || !isProjectDirty()) return;
      const wait = last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) { timer = setTimeout(run, wait); return; }
      running = true;
      try {
        const session = usePackageSession.getState();
        const projectId = session.projectId ?? newProjectId();
        if (!session.projectId) usePackageSession.setState({ projectId });
        const packaged = await packageCurrentProject(projectId);
        await writeRecovery({ projectId, name: packaged.doc.name, fileName: session.fileName, savedAt: Date.now(), bytes: new Blob([packaged.bytes as BlobPart]) });
        last = Date.now();
      } catch (err) {
        console.warn('[project] recovery copy failed', err);
      } finally {
        running = false;
      }
    };
    const touch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, IDLE_MS);
    };
    const offViewer = useViewerStore.subscribe((s, prev) => { if (s.mutationVersion !== prev.mutationVersion) touch(); });
    const offProject = useProjectStore.subscribe((s, prev) => { if (s !== prev) touch(); });
    return () => { offViewer(); offProject(); if (timer) clearTimeout(timer); };
  }, []);
}
