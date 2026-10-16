/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project package in the UI: Save (in place where the browser can write
 * the file it was opened from, else Save as), Save as, Open, Link model, and
 * Ctrl+S / Ctrl+Shift+S. After an open, the linked models the package refers
 * to are listed to locate. While the project has unsaved changes, a recovery
 * copy is kept in the browser (`recovery.ts`) and offered back at startup.
 * In the desktop app, a project opened from Finder opens here too.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { useIfc } from '@/hooks/useIfc';
import { useViewerStore } from '@/store';
import { PACKAGE_ACTION_EVENT, type PackageAction } from '@/project/package/actions';
import { openPath, pickFile, pickPackageToOpen } from '@/project/package/file-access';
import { isDesktop, onFilesOpened, takeOpenedPaths } from '@/lib/desktop/desktop-host';
import type { PackageModel } from '@/project/package/format';
import { loadLinkedModel, type ModelLoader } from '@/project/package/project-open';
import { saveProject } from '@/project/package/save-actions';
import { openProjectBytes, useLinkedToLocate } from '@/project/package/open-actions';
import { clearRecovery, readRecovery, type RecoveryEntry } from '@/project/package/recovery';
import { clearJournal, readJournal, type JournalEntry } from '@/project/package/journal';
import { restoreJournal } from '@/project/package/journal-restore';
import { usePackageSession } from '@/project/package/session';
import { useAutosaveRecovery, isProjectDirty } from './useAutosaveRecovery';
import { testCubesIfc } from '@/project/test-cubes';

const MODEL_FILES = '.ifc,.ifczip,.ifcx';
const TEST_CUBES = 1_000_000;
/** The demo project: a package authored in Lapin, shipped with the viewer. */
const DEMO_PROJECT_PATH = '/samples/demo-project.lapin';

export function ProjectPackageHost() {
  const { t } = useTranslation();
  const { addModel, clearAllModels, loadFile } = useIfc();
  const resetViewerState = useViewerStore((s) => s.resetViewerState);
  const linked = useLinkedToLocate((s) => s.models);
  const setLinked = (next: PackageModel[] | ((list: PackageModel[]) => PackageModel[])) =>
    useLinkedToLocate.setState((s) => ({ models: typeof next === 'function' ? next(s.models) : next }));
  const [recovery, setRecovery] = useState<RecoveryEntry | null>(null);
  const [journal, setJournal] = useState<JournalEntry | null>(null);
  const progress = usePackageSession((s) => s.progress);

  const loader: ModelLoader = {
    clearAll: () => { resetViewerState(); clearAllModels(); },
    // The first model loads as the primary one, so its geometry is served from (and kept in) the
    // load cache like any opened file (N4); the others are added to it.
    addModel: async (file, options) => {
      if (useViewerStore.getState().models.size > 0) return addModel(file, { name: options.name });
      const modelId = crypto.randomUUID();
      await loadFile(file, { kind: 'primary', modelId });
      if (!useViewerStore.getState().models.has(modelId)) return null;
      if (options.name) useViewerStore.getState().updateModel(modelId, { name: options.name });
      return modelId;
    },
  };

  const save = useCallback(async (as: boolean) => { await saveProject(as); }, []);

  const openBytes = useCallback(async (bytes: Uint8Array, fileName: string | null, handle: FileSystemFileHandle | null) => {
    await openProjectBytes(bytes, { fileName, handle }, loader);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addModel, clearAllModels, resetViewerState]);

  const open = useCallback(async () => {
    if (isProjectDirty() && !(await confirmDialog({ title: t('projectPackage.open'), description: t('projectPackage.discardChanges'), confirmLabel: t('projectPackage.openAnyway'), destructive: true }))) return;
    const picked = await pickPackageToOpen();
    if (picked) await openBytes(picked.bytes, picked.name, picked.handle);
  }, [t, openBytes]);

  // Opened without a file name or handle, so Save asks where to save rather than
  // pointing at the bundled sample.
  const openDemo = useCallback(async () => {
    if (isProjectDirty() && !(await confirmDialog({ title: t('projectPackage.open'), description: t('projectPackage.discardChanges'), confirmLabel: t('projectPackage.openAnyway'), destructive: true }))) return;
    usePackageSession.setState({ busy: 'opening', progress: t('projectPackage.opening') });
    let bytes: Uint8Array;
    try {
      const res = await fetch(DEMO_PROJECT_PATH);
      if (!res.ok) throw new Error(`${res.status} ${DEMO_PROJECT_PATH}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      usePackageSession.setState({ busy: null, progress: null });
      console.error('[demo] project package fetch failed', err);
      toast.error(t('viewportLighting.container.emptyState.loadDemo.failed'));
      return;
    }
    await openBytes(bytes, null, null);
  }, [t, openBytes]);

  const link = useCallback(async () => {
    const file = await pickFile(MODEL_FILES);
    if (!file) return;
    const id = await loadLinkedModel(file, loader);
    if (id) toast.success(t('projectPackage.linked', { name: file.name }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, addModel]);

  // A generated stress-test model, added beside what is open (or the first model).
  const testCubes = useCallback(async () => {
    const count = TEST_CUBES.toLocaleString('en-US');
    if (!(await confirmDialog({ title: t('projectPackage.testCubes'), description: t('projectPackage.testCubesConfirm', { count }), confirmLabel: t('projectPackage.testCubesGenerate') }))) return;
    try {
      const blob = await testCubesIfc(TEST_CUBES, {
        onProgress: (done) => usePackageSession.setState({ progress: t('projectPackage.testCubesProgress', { done: done.toLocaleString('en-US'), count }) }),
      });
      usePackageSession.setState({ progress: t('projectPackage.testCubesLoading', { count }) });
      const modelId = await loader.addModel(new File([blob], 'test-cubes.ifc'), { name: 'test-cubes.ifc' });
      // Added beside an open model, it would not be the active one: Export (which follows the active model) would write that one instead.
      if (modelId) useViewerStore.getState().setActiveModel(modelId);
    } finally {
      usePackageSession.setState({ progress: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, addModel, loadFile]);

  useEffect(() => {
    const onAction = (e: Event) => {
      const action = (e as CustomEvent<PackageAction>).detail;
      if (action === 'save') void save(false);
      else if (action === 'save-as') void save(true);
      else if (action === 'open') void open();
      else if (action === 'open-demo') void openDemo();
      else if (action === 'link') void link();
      else if (action === 'test-cubes') void testCubes();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void save(e.shiftKey);
    };
    window.addEventListener(PACKAGE_ACTION_EVENT, onAction);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(PACKAGE_ACTION_EVENT, onAction); window.removeEventListener('keydown', onKey); };
  }, [save, open, openDemo, link, testCubes]);

  // Desktop: projects opened from Finder (at launch or while running) — the last one opens.
  useEffect(() => {
    if (!isDesktop()) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const take = async () => {
      const path = (await takeOpenedPaths()).pop();
      if (!path) return;
      if (isProjectDirty() && !(await confirmDialog({ title: t('projectPackage.open'), description: t('projectPackage.discardChanges'), confirmLabel: t('projectPackage.openAnyway'), destructive: true }))) return;
      try {
        const opened = await openPath(path);
        await openBytes(opened.bytes, opened.name, opened.handle);
      } catch (err) {
        toast.error(t('projectPackage.openFailed', { detail: err instanceof Error ? err.message : String(err) }));
      }
    };
    void onFilesOpened(() => { void take(); }).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    void take();
    return () => { cancelled = true; stop?.(); };
  }, [t, openBytes]);

  // A recovery copy left by a session that ended with unsaved changes: the journal when it is the newer.
  useEffect(() => {
    void Promise.all([readRecovery(), readJournal()]).then(([entry, journalled]) => {
      if (useViewerStore.getState().models.size > 0) return;
      if (journalled && (!entry || journalled.at >= entry.savedAt)) setJournal(journalled);
      else if (entry) setRecovery(entry);
    });
  }, []);
  useAutosaveRecovery();

  const locate = async (model: PackageModel) => {
    const file = await pickFile(MODEL_FILES);
    if (!file) return;
    const id = await loadLinkedModel(file, loader);
    if (id) setLinked((list) => list.filter((m) => m !== model));
  };

  return (
    <>
      {progress ? (
        <output aria-live="polite" className="fixed left-1/2 top-24 z-50 block -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">{progress}</output>
      ) : null}
      <Dialog open={linked.length > 0} onOpenChange={(o) => { if (!o) setLinked([]); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('projectPackage.linkedTitle')}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{t('projectPackage.linkedHint')}</p>
          <ul className="space-y-1 text-xs">
            {linked.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 rounded-sm border border-zinc-200 px-2 py-1 dark:border-zinc-800">
                <span className="truncate">{m.name}</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => void locate(m)}>{t('projectPackage.locate')}</Button>
              </li>
            ))}
          </ul>
          <DialogFooter><Button size="sm" variant="ghost" onClick={() => setLinked([])}>{t('projectPackage.skipLinked')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {journal ? (
        <output className="fixed bottom-14 left-4 z-50 block w-80 space-y-2 rounded-md border border-primary bg-white p-3 text-xs shadow-lg dark:bg-zinc-900">
          <p className="font-semibold">{t('projectPackage.recoveryTitle')}</p>
          <p className="text-muted-foreground">{t('projectPackage.recoveryText', { name: journal.name, time: new Date(journal.at).toLocaleString() })}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setJournal(null); void clearJournal(); void clearRecovery(); }}>{t('projectPackage.recoveryDiscard')}</Button>
            <Button size="sm" onClick={async () => {
              const entry = journal;
              setJournal(null);
              usePackageSession.setState({ busy: 'opening', progress: t('projectPackage.opening') });
              try {
                const failed = await restoreJournal(entry, loader);
                if (failed.length) toast.error(t('projectPackage.modelsFailed', { names: failed.join(', ') }));
                // Still unsaved: it came from the journal, not from the file.
                usePackageSession.setState({ projectId: entry.projectId, fileName: entry.fileName, handle: null, savedMutationVersion: -1 });
              } finally {
                usePackageSession.setState({ busy: null, progress: null });
              }
            }}>{t('projectPackage.recoveryOpen')}</Button>
          </div>
        </output>
      ) : null}
      {recovery ? (
        <output className="fixed bottom-14 left-4 z-50 block w-80 space-y-2 rounded-md border border-primary bg-white p-3 text-xs shadow-lg dark:bg-zinc-900">
          <p className="font-semibold">{t('projectPackage.recoveryTitle')}</p>
          <p className="text-muted-foreground">{t('projectPackage.recoveryText', { name: recovery.name, time: new Date(recovery.savedAt).toLocaleString() })}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setRecovery(null); void clearRecovery(); }}>{t('projectPackage.recoveryDiscard')}</Button>
            <Button size="sm" onClick={async () => {
              const entry = recovery;
              setRecovery(null);
              await openBytes(new Uint8Array(await entry.bytes.arrayBuffer()), entry.fileName, null);
              // Still unsaved: it came from the recovery copy, not from the file.
              usePackageSession.setState({ savedMutationVersion: -1 });
            }}>{t('projectPackage.recoveryOpen')}</Button>
          </div>
        </output>
      ) : null}
    </>
  );
}

