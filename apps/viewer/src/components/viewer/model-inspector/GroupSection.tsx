/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The model group of the inspected element (`project/element-groups.ts`):
 * its name (renamed in place), how many elements it holds, and Select /
 * Edit group / Ungroup.
 */

import { useId, useMemo } from 'react';
import { groupOfElement, groupMembers, modelGroups } from '@ifc-lite/create';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { useViewerStore } from '@/store';
import { renameGroup, selectGroup, startGroupEdit, ungroupSelection, useGroupEdit } from '@/project/element-groups';
import { CommitField, InspectorRow, InspectorSection } from './InspectorControls';
import type { InspectorSelection } from './useInspectorTarget';

export function GroupSection({ selection }: { selection: InspectorSelection }) {
  const { t } = useTranslation();
  const id = useId();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const editing = useGroupEdit((s) => s.editing);
  const { modelId, expressId, live } = selection;
  const group = useMemo(() => {
    void mutationVersion;
    const groupId = groupOfElement(live.dataStore, expressId, live.view);
    if (groupId === null) return null;
    const name = modelGroups(live.dataStore, live.view).find((g) => g.id === groupId)?.name ?? '';
    return { modelId, groupId, name, members: groupMembers(live.dataStore, groupId, live.view) };
  }, [live, expressId, modelId, mutationVersion]);
  if (!group) return null;
  const isEdited = editing?.groupId === group.groupId && editing.modelId === modelId;
  return (
    <InspectorSection title={t('groups.section')}>
      <InspectorRow label={t('groups.name')} htmlFor={id}>
        <CommitField id={id} value={group.name} onCommit={(v) => renameGroup(group, v)} />
      </InspectorRow>
      <p className="px-1 text-2xs text-zinc-500">{t('groups.members', { count: group.members.length })}</p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="h-7 px-2 text-2xs" onClick={() => selectGroup(group)}>{t('groups.selectAll')}</Button>
        {!isEdited && <Button size="sm" variant="outline" className="h-7 px-2 text-2xs" onClick={() => startGroupEdit(group)}>{t('groups.cmd.edit')}</Button>}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-2xs" onClick={() => { selectGroup(group); ungroupSelection(); }}>{t('groups.cmd.ungroup')}</Button>
      </div>
    </InspectorSection>
  );
}
