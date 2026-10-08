/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The layer manager: layers filed under groups (a group switches and locks
 * its layers together), each with colour, pen weight, line type, on / lock,
 * and — when a view is in front — whether that view shows it. The radio
 * marks the current layer new drafting goes on.
 */

import { Eye, EyeOff, FolderPlus, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useProjectStore } from '@/project/project-store';
import { useDocumentTabs } from '@/project/document-tabs';
import {
  addLayer, addLayerGroup, removeLayer, removeLayerGroup, toggleViewLayers, updateLayer, updateLayerGroup,
} from '@/project/drafting-standards';
import { currentLayerId, setCurrentLayer, useDraftingSession } from '@/drafting/session';
import type { LineType } from '@/drafting/styles';
import type { DraftLayer } from '@/drafting/types';

const WEIGHTS = [0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4];
const TYPES: readonly LineType[] = ['continuous', 'dashed', 'dotted', 'dashdot'];
const INPUT = 'h-7 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs';

function Toggle({ on, label, onClick, icons }: { on: boolean; label: string; onClick: () => void; icons: [React.ReactNode, React.ReactNode] }) {
  return (
    <IconButton label={label} className="size-7" aria-pressed={on} onClick={onClick}>
      {on ? icons[0] : icons[1]}
    </IconButton>
  );
}

export function LayersTab() {
  const { t } = useTranslation();
  useDraftingSession((s) => s.revision);
  const layers = useProjectStore((s) => s.draftLayers);
  const groups = useProjectStore((s) => s.layerGroups) ?? [];
  const activeId = useDocumentTabs((s) => s.activeId);
  const view = useProjectStore((s) => s.views.find((v) => v.id === activeId && v.kind !== '3d'));
  const current = currentLayerId();
  const sections = [
    ...groups.map((g) => ({ group: g, layers: layers.filter((l) => l.group === g.id) })),
    { group: null, layers: layers.filter((l) => !l.group || !groups.some((g) => g.id === l.group)) },
  ];

  const row = (l: DraftLayer) => (
    <tr key={l.id} className="border-t border-zinc-100 dark:border-zinc-800">
      <td className="py-1">
        <input type="radio" name="current-layer" aria-label={`${l.name} · ${t('standards.layer.current')}`} checked={current === l.id} onChange={() => setCurrentLayer(l.id)} />
      </td>
      <td className="py-1 pr-2">
        <input aria-label={t('standards.layer.name')} className={`${INPUT} w-36`} defaultValue={l.name} key={l.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && updateLayer(l.id, { name: e.target.value.trim() })} />
      </td>
      <td className="py-1"><input type="color" aria-label={`${l.name} · ${t('standards.layer.color')}`} className="h-7 w-9 cursor-pointer rounded-sm border border-zinc-300 dark:border-zinc-700" value={l.color} onChange={(e) => updateLayer(l.id, { color: e.target.value })} /></td>
      <td className="py-1">
        <select aria-label={`${l.name} · ${t('standards.layer.weight')}`} className={INPUT} value={l.lineWeight ?? 0.25} onChange={(e) => updateLayer(l.id, { lineWeight: Number(e.target.value) })}>
          {WEIGHTS.map((w) => <option key={w} value={w}>{w.toFixed(2)}</option>)}
        </select>
      </td>
      <td className="py-1">
        <select aria-label={`${l.name} · ${t('standards.layer.type')}`} className={INPUT} value={l.lineType ?? 'continuous'} onChange={(e) => updateLayer(l.id, { lineType: e.target.value as LineType })}>
          {TYPES.map((k) => <option key={k} value={k}>{t(`standards.layer.type.${k}` as TranslationKey)}</option>)}
        </select>
      </td>
      <td className="py-1">
        <select aria-label={`${l.name} · ${t('standards.layer.group')}`} className={INPUT} value={l.group ?? ''} onChange={(e) => updateLayer(l.id, { group: e.target.value || undefined })}>
          <option value="">{t('standards.layer.ungrouped')}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </td>
      <td className="py-1 whitespace-nowrap">
        <Toggle on={l.visible} label={`${l.name} · ${t('standards.layer.visible')}`} onClick={() => updateLayer(l.id, { visible: !l.visible })} icons={[<Eye key="on" className="size-3.5" />, <EyeOff key="off" className="size-3.5 text-zinc-400" />]} />
        <Toggle on={l.locked} label={`${l.name} · ${t('standards.layer.locked')}`} onClick={() => updateLayer(l.id, { locked: !l.locked })} icons={[<Lock key="on" className="size-3.5" />, <LockOpen key="off" className="size-3.5 text-zinc-400" />]} />
      </td>
      {view ? (
        <td className="py-1 text-center">
          <input type="checkbox" aria-label={`${l.name} · ${t('standards.layer.inView', { view: view.name })}`} checked={!view.hiddenLayers?.includes(l.id)}
            onChange={(e) => toggleViewLayers(view.id, [l.id], !e.target.checked)} />
        </td>
      ) : null}
      <td className="py-1 text-right">
        {l.id !== '0' ? (
          <IconButton label={t('standards.layer.delete', { name: l.name })} className="size-7" onClick={() => removeLayer(l.id)}><Trash2 className="size-3.5" /></IconButton>
        ) : null}
      </td>
    </tr>
  );

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setCurrentLayer(addLayer(t('standards.layer.newName', { n: layers.length })))}>
          <Plus className="mr-1 size-3.5" />{t('standards.layer.add')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => addLayerGroup(t('standards.layer.newGroup', { n: groups.length + 1 }))}>
          <FolderPlus className="mr-1 size-3.5" />{t('standards.layer.addGroup')}
        </Button>
        <p className="flex-1 text-right text-zinc-500">{t('standards.layer.hint')}</p>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="w-6"><span className="sr-only">{t('standards.layer.current')}</span></th>
            <th className="py-1 font-medium">{t('standards.layer.name')}</th>
            <th className="py-1 font-medium">{t('standards.layer.color')}</th>
            <th className="py-1 font-medium">{t('standards.layer.weight')}</th>
            <th className="py-1 font-medium">{t('standards.layer.type')}</th>
            <th className="py-1 font-medium">{t('standards.layer.group')}</th>
            <th className="py-1 font-medium">{t('standards.layer.visible')}</th>
            {view ? <th className="py-1 font-medium text-center">{t('standards.layer.inView', { view: view.name })}</th> : null}
            <th><span className="sr-only">{t('standards.layer.delete', { name: '' })}</span></th>
          </tr>
        </thead>
        {sections.map(({ group, layers: members }) => (
          <tbody key={group?.id ?? 'ungrouped'}>
            <tr className="bg-zinc-50 dark:bg-zinc-900">
              <td colSpan={view ? 9 : 8} className="py-1 px-1">
                <div className="flex items-center gap-2 font-semibold">
                  {group ? (
                    <>
                      <input aria-label={t('standards.layer.groupName')} className={`${INPUT} w-40 font-semibold`} defaultValue={group.name} key={group.name}
                        onBlur={(e) => e.target.value.trim() && updateLayerGroup(group.id, { name: e.target.value.trim() })} />
                      <Toggle on={group.visible} label={`${group.name} · ${t('standards.layer.visible')}`} onClick={() => updateLayerGroup(group.id, { visible: !group.visible })} icons={[<Eye key="on" className="size-3.5" />, <EyeOff key="off" className="size-3.5 text-zinc-400" />]} />
                      <Toggle on={group.locked} label={`${group.name} · ${t('standards.layer.locked')}`} onClick={() => updateLayerGroup(group.id, { locked: !group.locked })} icons={[<Lock key="on" className="size-3.5" />, <LockOpen key="off" className="size-3.5 text-zinc-400" />]} />
                      {view && members.length > 0 ? (
                        <label className="flex items-center gap-1 font-normal">
                          <input type="checkbox" checked={members.every((l) => !view.hiddenLayers?.includes(l.id))}
                            onChange={(e) => toggleViewLayers(view.id, members.map((l) => l.id), !e.target.checked)} />
                          {t('standards.layer.inView', { view: view.name })}
                        </label>
                      ) : null}
                      <span className="flex-1" />
                      <IconButton label={t('standards.layer.deleteGroup', { name: group.name })} className="size-7" onClick={() => removeLayerGroup(group.id)}><Trash2 className="size-3.5" /></IconButton>
                    </>
                  ) : <span className="text-zinc-500">{t('standards.layer.ungrouped')}</span>}
                </div>
              </td>
            </tr>
            {members.map(row)}
          </tbody>
        ))}
      </table>
    </div>
  );
}
