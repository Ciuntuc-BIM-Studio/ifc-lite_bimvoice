/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The bar shown while a group is in edit mode (Revit's "Edit Group"
 * panel): the group's name and size, Add / Remove picking, and Finish.
 * Escape finishes too (or leaves Add / Remove picking first).
 */

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { finishGroupEdit, groupById, setGroupPicking, useGroupEdit } from '@/project/element-groups';

export function GroupEditBar() {
  const { t } = useTranslation();
  const editing = useGroupEdit((s) => s.editing);
  const picking = useGroupEdit((s) => s.picking);
  useViewerStore((s) => s.mutationVersion);
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useGroupEdit.getState().picking) setGroupPicking(null);
      else finishGroupEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);
  if (!editing) return null;
  const group = groupById(editing.modelId, editing.groupId);
  const hint = picking === 'add' ? t('groups.addHint') : picking === 'remove' ? t('groups.removeHint') : t('groups.editHint');
  return (
    <div role="toolbar" aria-label={t('groups.editing')}
      className="fixed bottom-10 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border border-primary/40 bg-white px-3 py-2 text-xs shadow-lg dark:bg-zinc-900">
      <span className="font-semibold">{t('groups.editing')}: {editing.name}</span>
      <span className="text-zinc-500">{t('groups.members', { count: group?.members.length ?? 0 })}</span>
      <span className="max-w-[22rem] truncate text-zinc-500">{hint}</span>
      <Button size="sm" variant={picking === 'add' ? 'default' : 'outline'} aria-pressed={picking === 'add'} onClick={() => setGroupPicking('add')}>{t('groups.add')}</Button>
      <Button size="sm" variant={picking === 'remove' ? 'default' : 'outline'} aria-pressed={picking === 'remove'} onClick={() => setGroupPicking('remove')}>{t('groups.remove')}</Button>
      <Button size="sm" onClick={finishGroupEdit}>{t('groups.finish')}</Button>
    </div>
  );
}
