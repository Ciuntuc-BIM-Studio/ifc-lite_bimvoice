/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project package in the UI: Save (in place where the browser can write
 * the file it was opened from, else Save as), Save as, Open, Link model, and
 * Ctrl+S / Ctrl+Shift+S. After an open, the linked models the package refers
 * to are listed to locate. While the project has unsaved changes, a recovery
 * copy is kept in the browser (`recovery.ts`) and offered back at startup.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { useIfc } from '@/hooks/useIfc';
import { useViewerStore } from '@/store';
import { sanitizeFilename } from '@/lib/export/download';
import { projectDocument, useProjectStore } from '@/project/project-store';
import { PACKAGE_ACTION_EVENT, type PackageAction } from '@/project/package/actions';
import { canWriteInPlace, downloadPackage, pickFile, pickPackageToOpen, pickSaveTarget, writeToHandle } from '@/project/package/file-access';
import { PACKAGE_SUFFIX, type PackageModel } from '@/project/package/format';
import { loadLinkedModel, openPackageBytes, type ModelLoader } from '@/project/package/project-open';
import { packageCurrentProject } from '@/project/package/project-save';
import { clearRecovery, readRecovery, type RecoveryEntry } from '@/project/package/recovery';
import { newProjectId, usePackageSession } from '@/project/package/session';
import { useAutosaveRecovery, isProjectDirty } from './useAutosaveRecovery';

const MODEL_FILES = '.ifc,.ifczip,.ifcx';

export function ProjectPackageHost() {
  const { t } = useTranslation();
  const { addModel, clearAllModels } = useIfc();
  const resetViewerState = useViewerStore((s) => s.resetViewerState);
  const [linked, setLinked] = useState<PackageModel[]>([]);
  const [recovery, setRecovery] = useState<RecoveryEntry | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const busy = useRef(false);

  const loader: ModelLoader = {
    clearAll: () => { resetViewerState(); clearAllModels(); },
    addModel: (file, options) => addModel(file, { name: options.name }),
  };

  const save = useCallback(async (as: boolean) => {
    if (busy.current) return;
    if (useViewerStore.getState().models.size === 0) { toast.info(t('projectPackage.nothingToSave')); return; }
    busy.current = true;
    const session = usePackageSession.getState();
    try {
      const name = sanitizeFilename(useProjectStore.getState().name || 'project', { fallback: 'project' });
      let handle = as ? null : session.handle;
      if (!handle && canWriteInPlace()) {
        handle = await pickSaveTarget(session.fileName ?? `${name}${PACKAGE_SUFFIX}`);
        if (!handle) return;
      }
      usePackageSession.setState({ busy: 'saving' });
      const projectId = session.projectId ?? newProjectId();
      setProgress(t('projectPackage.saving'));
      try {
        const packaged = await packageCurrentProject(projectId, { onProgress: (label) => setProgress(t('projectPackage.savingModel', { name: label })) });
        const fileName = handle?.name ?? session.fileName ?? `${name}${PACKAGE_SUFFIX}`;
        if (handle) await writeToHandle(handle, packaged.bytes);
        else downloadPackage(packaged.bytes, fileName);
        usePackageSession.setState({
          projectId, fileName, handle, savedAt: Date.now(),
          savedMutationVersion: useViewerStore.getState().mutationVersion, savedDocument: JSON.stringify(projectDocument()),
        });
        await clearRecovery();
        toast.success(t('projectPackage.saved', { name: fileName, mb: (packaged.bytes.byteLength / 1e6).toFixed(1) }));
      } catch (err) {
        toast.error(t('projectPackage.saveFailed', { detail: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      usePackageSession.setState({ busy: null });
      setProgress(null);
      busy.current = false;
    }
  }, [t]);

  const openBytes = useCallback(async (bytes: Uint8Array, fileName: string | null, handle: FileSystemFileHandle | null) => {
    usePackageSession.setState({ busy: 'opening' });
    setProgress(t('projectPackage.opening'));
    try {
      const result = await openPackageBytes(bytes, loader, (label) => setProgress(t('projectPackage.openingModel', { name: label })));
      usePackageSession.setState({
        projectId: result.opened.manifest.projectId, fileName, handle, savedAt: Date.parse(result.opened.manifest.savedAt) || null,
        savedMutationVersion: useViewerStore.getState().mutationVersion, savedDocument: JSON.stringify(projectDocument()),
      });
      await clearRecovery();
      if (result.failed.length) toast.error(t('projectPackage.modelsFailed', { names: result.failed.join(', ') }));
      else toast.success(t('projectPackage.opened', { name: result.opened.manifest.projectName }));
      setLinked(result.linked);
    } catch (err) {
      toast.error(t('projectPackage.openFailed', { detail: err instanceof Error ? err.message : String(err) }));
    } finally {
      usePackageSession.setState({ busy: null });
      setProgress(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, addModel, clearAllModels, resetViewerState]);

  const open = useCallback(async () => {
    if (isProjectDirty() && !(await confirmDialog({ title: t('projectPackage.open'), description: t('projectPackage.discardChanges'), confirmLabel: t('projectPackage.openAnyway'), destructive: true }))) return;
    const picked = await pickPackageToOpen();
    if (picked) await openBytes(picked.bytes, picked.name, picked.handle);
  }, [t, openBytes]);

  const link = useCallback(async () => {
    const file = await pickFile(MODEL_FILES);
    if (!file) return;
    const id = await loadLinkedModel(file, loader);
    if (id) toast.success(t('projectPackage.linked', { name: file.name }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, addModel]);

  useEffect(() => {
    const onAction = (e: Event) => {
      const action = (e as CustomEvent<PackageAction>).detail;
      if (action === 'save') void save(false);
      else if (action === 'save-as') void save(true);
      else if (action === 'open') void open();
      else if (action === 'link') void link();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void save(e.shiftKey);
    };
    window.addEventListener(PACKAGE_ACTION_EVENT, onAction);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(PACKAGE_ACTION_EVENT, onAction); window.removeEventListener('keydown', onKey); };
  }, [save, open, link]);

  // A recovery copy left by a session that ended with unsaved changes.
  useEffect(() => {
    void readRecovery().then((entry) => { if (entry && useViewerStore.getState().models.size === 0) setRecovery(entry); });
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

