/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The recovery copy, while the open project differs from what was last saved
 * or opened:
 *  - the edit journal (`journal.ts`, N5): JOURNAL_MS after any change to the
 *    models or the project document, and when the page is hidden, each
 *    model's overlay and history are written over its source — milliseconds,
 *    no export;
 *  - for a project the journal cannot cover (a streamed source), the whole
 *    project packaged, once the user has paused (IDLE_MS) and at most every
 *    MIN_INTERVAL_MS, since packaging exports the edited native models.
 */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';
import { projectDocument, useProjectStore } from '@/project/project-store';
import { packageCurrentProject } from '@/project/package/project-save';
import { writeRecovery } from '@/project/package/recovery';
import { captureJournal, journalCovers, writeJournal } from '@/project/package/journal';
import { newProjectId, usePackageSession } from '@/project/package/session';

const IDLE_MS = 8_000;
const JOURNAL_MS = 250;
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
      // Scheduled while a model was still loading (its source not yet resident), the journal may cover
      // it by now: milliseconds instead of packaging the whole project (seconds for a large model).
      if (journalCovers()) { void journal(); return; }
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
    let journalTimer: ReturnType<typeof setTimeout> | null = null;
    let journalling = false;
    const journal = async () => {
      journalTimer = null;
      if (journalling || usePackageSession.getState().busy || !isProjectDirty()) return;
      journalling = true;
      try {
        const session = usePackageSession.getState();
        const projectId = session.projectId ?? newProjectId();
        if (!session.projectId) usePackageSession.setState({ projectId });
        await writeJournal(captureJournal(useViewerStore.getState(), { projectId, fileName: session.fileName }));
      } catch (err) {
        console.warn('[project] journal write failed', err);
      } finally {
        journalling = false;
      }
    };
    const touch = () => {
      if (journalCovers()) {
        if (journalTimer) clearTimeout(journalTimer);
        journalTimer = setTimeout(() => void journal(), JOURNAL_MS);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, IDLE_MS);
    };
    const flush = () => { if (journalTimer) { clearTimeout(journalTimer); void journal(); } };
    window.addEventListener('pagehide', flush);
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHidden);
    const offViewer = useViewerStore.subscribe((s, prev) => { if (s.mutationVersion !== prev.mutationVersion) touch(); });
    const offProject = useProjectStore.subscribe((s, prev) => { if (s !== prev) touch(); });
    return () => {
      offViewer(); offProject();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      if (timer) clearTimeout(timer);
      if (journalTimer) clearTimeout(journalTimer);
    };
  }, []);
}
