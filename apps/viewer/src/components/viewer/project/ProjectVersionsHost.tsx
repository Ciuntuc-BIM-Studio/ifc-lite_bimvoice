/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Project versions in the UI: Save to version (a name and what changed),
 * Update version (what changed), and the history — every version of the
 * open project with its date, size and note, the current one marked; open
 * one, see what changed from the version before it, or delete it from this
 * browser.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { confirmDialog, promptDialog } from '@/components/ui/confirm-dialog';
import { useIfc } from '@/hooks/useIfc';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { PACKAGE_ACTION_EVENT, type PackageAction } from '@/project/package/actions';
import { zipPackage } from '@/project/package/package-io';
import { openProjectBytes } from '@/project/package/open-actions';
import { usePackageSession } from '@/project/package/session';
import { currentVault, saveToVersion, updateCurrentVersion } from '@/project/package/version-actions';
import { compareVersions, versionFiles, type VersionRecord } from '@/project/package/versions';
import { isProjectDirty } from './useAutosaveRecovery';

const INPUT = 'h-8 w-full rounded-sm border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700';

export function ProjectVersionsHost() {
  const { t } = useTranslation();
  const { addModel, clearAllModels } = useIfc();
  const resetViewerState = useViewerStore((s) => s.resetViewerState);
  const [asking, setAsking] = useState<{ number: number } | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<VersionRecord[] | null>(null);
  const current = usePackageSession((s) => s.version);
  const projectName = useProjectStore((s) => s.name);

  const loadHistory = useCallback(async () => {
    const id = usePackageSession.getState().projectId;
    setHistory(id ? await currentVault().listVersions(id) : []);
  }, []);

  useEffect(() => {
    const onAction = async (e: Event) => {
      const action = (e as CustomEvent<PackageAction>).detail;
      if (action === 'save-version') {
        const id = usePackageSession.getState().projectId;
        const n = (id ? await currentVault().listVersions(id) : []).reduce((m, v) => Math.max(m, v.number), 0) + 1;
        setName('');
        setMessage('');
        setAsking({ number: n });
      } else if (action === 'update-version') {
        const v = usePackageSession.getState().version;
        if (!v) { void updateCurrentVersion(); return; }
        const note = await promptDialog({ title: t('projectVersions.update'), description: t('projectVersions.updatePrompt', { number: v.number, name: v.name }), confirmLabel: t('projectVersions.update') });
        if (note !== null) void updateCurrentVersion(note || undefined);
      } else if (action === 'history') {
        void loadHistory();
      }
    };
    window.addEventListener(PACKAGE_ACTION_EVENT, onAction);
    return () => window.removeEventListener(PACKAGE_ACTION_EVENT, onAction);
  }, [t, loadHistory]);

  const open = async (record: VersionRecord) => {
    if (isProjectDirty() && !(await confirmDialog({ title: t('projectPackage.open'), description: t('projectPackage.discardChanges'), confirmLabel: t('projectPackage.openAnyway'), destructive: true }))) return;
    setHistory(null);
    const bytes = zipPackage(await versionFiles(currentVault(), record));
    await openProjectBytes(bytes, { fileName: usePackageSession.getState().fileName, handle: usePackageSession.getState().handle }, {
      clearAll: () => { resetViewerState(); clearAllModels(); },
      addModel: (file, options) => addModel(file, { name: options.name }),
    });
  };

  const remove = async (record: VersionRecord) => {
    if (!(await confirmDialog({ title: t('projectVersions.delete'), description: t('projectVersions.deleteConfirm', { number: record.number, name: record.name }), confirmLabel: t('projectVersions.delete'), destructive: true }))) return;
    const id = usePackageSession.getState().projectId;
    if (id) await currentVault().deleteVersion(id, record.id);
    if (usePackageSession.getState().version?.id === record.id) usePackageSession.setState({ version: null });
    void loadHistory();
  };

  return (
    <>
      <Dialog open={asking !== null} onOpenChange={(o) => { if (!o) setAsking(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('projectVersions.saveTitle')}</DialogTitle></DialogHeader>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{t('projectVersions.name')}</span>
            <input className={INPUT} value={name} placeholder={t('projectVersions.namePlaceholder', { number: asking?.number ?? 1 })} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{t('projectVersions.message')}</span>
            <textarea className={`${INPUT} h-20 py-1`} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>{t('projectVersions.cancel')}</Button>
            <Button size="sm" onClick={() => { setAsking(null); void saveToVersion(name, message); }}>{t('projectVersions.saveButton')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={history !== null} onOpenChange={(o) => { if (!o) setHistory(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{t('projectVersions.historyTitle', { name: projectName })}</DialogTitle></DialogHeader>
          {history?.length ? (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto text-xs">
              {[...history].reverse().map((v) => {
                const previous = history.filter((x) => x.number < v.number).at(-1);
                const diff = previous ? compareVersions(previous.manifest, v.manifest) : null;
                return (
                  <li key={v.id} data-version-row className={`rounded-sm border px-2 py-1.5 ${current?.id === v.id ? 'border-primary' : 'border-zinc-200 dark:border-zinc-800'}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">{v.number}</span>
                      <span className="flex-1 truncate font-medium">{v.name}{current?.id === v.id ? <span className="ml-2 text-2xs text-primary">{t('projectVersions.current')}</span> : null}</span>
                      <span className="tabular-nums text-muted-foreground">{t('projectVersions.meta', { date: new Date(v.updatedAt).toLocaleString(), size: v.size < 1e6 ? t('projectVersions.kb', { n: Math.max(1, Math.round(v.size / 1e3)) }) : t('projectVersions.mb', { n: (v.size / 1e6).toFixed(1) }) })}</span>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => void open(v)}>{t('projectVersions.openVersion')}</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => void remove(v)}>{t('projectVersions.delete')}</Button>
                    </div>
                    {v.message ? <p className="mt-0.5 text-muted-foreground">{v.message}</p> : null}
                    {v.revisions.length ? <p className="text-2xs text-muted-foreground">{t('projectVersions.revisions', { count: v.revisions.length })}</p> : null}
                    {diff ? (
                      <p className="text-2xs text-muted-foreground">
                        {t('projectVersions.compare', { list: Object.keys(diff.areas).length
                          ? Object.entries(diff.areas).map(([area, n]) => t('projectVersions.areaCount', { area: t(`projectVersions.area.${area}` as TranslationKey), n })).join(', ')
                          : t('projectVersions.noChanges') })}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t('projectVersions.none')}</p>}
          <p className="text-2xs text-muted-foreground">{t('projectVersions.storageNote')}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
