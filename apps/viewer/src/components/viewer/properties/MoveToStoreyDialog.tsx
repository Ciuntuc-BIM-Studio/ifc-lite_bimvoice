/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Design › Move to storey: the selection (one model's) goes to the storey
 * picked, kept relative to the storey (it moves with the level) or kept
 * where it is in space.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { moveToStorey, selectionByModel, storeysOf, useMoveToStoreyDialog } from '@/project/element-relocate';
import type { StoreyKeep } from '@ifc-lite/create';

const CELL = 'h-8 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1.5 text-sm';

export function MoveToStoreyDialog() {
  const { t } = useTranslation();
  const open = useMoveToStoreyDialog((s) => s.open);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const byModel = useMemo(() => (open ? selectionByModel() : new Map<string, number[]>()), [open, mutationVersion]);
  const [modelId, ids] = [...byModel.entries()][0] ?? [null, []];
  const modelName = modelId ? useViewerStore.getState().models.get(modelId)?.name ?? modelId : '';
  const storeys = useMemo(() => (modelId ? storeysOf(modelId) : []), [modelId, mutationVersion]);
  const [storeyId, setStoreyId] = useState<number | null>(null);
  const [keep, setKeep] = useState<StoreyKeep>('storey');
  const target = storeyId ?? storeys[storeys.length > 1 ? 1 : 0]?.expressId ?? null;
  const close = () => useMoveToStoreyDialog.setState({ open: false });
  const run = () => {
    if (!modelId || target === null) return;
    const result = moveToStorey(modelId, ids, target, keep);
    if (!result.ok) { toast.error(t('relocate.failed')); return; }
    toast.success(t('relocate.moved', { count: result.moved, storey: storeys.find((s) => s.expressId === target)?.name ?? `#${target}` }));
    close();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>{t('relocate.title')}</DialogTitle></DialogHeader>
        {!modelId ? <p className="text-sm text-zinc-500">{t('relocate.nothing')}</p> : (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-500">{t('relocate.selection', { count: ids.length, model: modelName })}</p>
            {byModel.size > 1 ? <p className="text-amber-600">{t('relocate.twoModels', { model: modelName })}</p> : null}
            <label className="grid grid-cols-[5rem_1fr] items-center gap-2">
              <span>{t('relocate.storey')}</span>
              <select aria-label={t('relocate.storey')} className={CELL} value={target ?? ''} onChange={(e) => setStoreyId(Number(e.target.value))}>
                {storeys.map((s) => <option key={s.expressId} value={s.expressId}>{t('relocate.storeyOption', { name: s.name, elevation: s.elevation.toFixed(2) })}</option>)}
              </select>
            </label>
            {(['storey', 'world'] as const).map((k) => (
              <label key={k} className="flex items-start gap-2">
                <input type="radio" name="relocate-keep" className="mt-1" checked={keep === k} onChange={() => setKeep(k)} />
                <span>{t(`relocate.keep.${k}`)}</span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>{t('relocate.cancel')}</Button>
          <Button disabled={!modelId || target === null} onClick={run}>{t('relocate.move')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
