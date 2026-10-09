/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * While a roof is edited as a block: what is being edited, Finish, and the
 * keys — Escape leaves, Delete deletes the selected part (an override,
 * Restore deleted brings it back) instead of the viewer's global Delete,
 * which hides the selection.
 */

import { useEffect } from 'react';
import { readRoofSystem } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { stopRoofEdit, useRoofDialog } from '@/project/roof-dialog-store';
import { roofPartOfRenderId, setPartOverride } from '@/project/roof-block';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function RoofEditBar() {
  const { t } = useTranslation();
  const editing = useRoofDialog((s) => s.editing);
  const name = useViewerStore((s) => {
    if (!editing) return '';
    const ds = s.models.get(editing.modelId)?.ifcDataStore;
    return (ds ? readRoofSystem(ds, editing.roofId, s.mutationViews.get(editing.modelId) ?? null)?.name : null) ?? '';
  });
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === 'Escape') { stopRoofEdit(); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const id = useViewerStore.getState().selectedEntityId;
      const part = typeof id === 'number' ? roofPartOfRenderId(id) : null;
      if (!part) return;
      // Ahead of the viewer's global Delete (hide selection): inside the roof, Delete deletes the part.
      e.preventDefault();
      e.stopPropagation();
      const result = setPartOverride(part, { deleted: true });
      if (result.ok) { useViewerStore.getState().setSelectedEntityIds([]); toast.info(t('roofBlock.partDeleted')); }
      else toast.error(`${t('roofBlock.failed')}: ${result.error}`);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, t]);
  if (!editing) return null;
  return (
    <output className="fixed bottom-12 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border border-primary bg-white/95 px-3 py-1.5 text-xs shadow-lg dark:bg-zinc-900/95">
      <span>{t('roofBlock.editBar', { name })}</span>
      <Button size="sm" className="h-7" onClick={stopRoofEdit}>{t('roofBlock.finish')}</Button>
    </output>
  );
}
