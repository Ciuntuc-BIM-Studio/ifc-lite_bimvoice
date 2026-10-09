/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The corridor's components: library profiles swept over a station range —
 * which profile, on which side, attached where, from / to, offset, whether
 * they replace the earthwork slopes, and (a wall from a preset) whether
 * their height follows the ground. "Refresh" copies the library's current
 * version of the profile in.
 */

import { useState } from 'react';
import { BookOpen, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { PROFILE_PRESETS, buildAlignment, componentFromProfile, type ComponentAttach, type ComponentDaylight, type ComponentSide, type CorridorComponent, type CorridorSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import { openProfileLibrary } from '@/civil/profile-library';
import { INPUT, Section } from '../joinery/JoineryFields';
import { Cell } from './CorridorFields';
import { ProfileCanvas } from './ProfileCanvas';
import { ComponentProfileEditor } from './ComponentProfileEditor';

interface Props {
  spec: CorridorSpec;
  onChange: (spec: CorridorSpec) => void;
}

const SIDES: ComponentSide[] = ['left', 'right', 'centre'];
const ATTACH: ComponentAttach[] = ['edge', 'axis'];
const DAYLIGHT: ComponentDaylight[] = ['keep', 'side', 'both'];

export function ComponentFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  const library = useProjectStore((s) => s.structureProfiles) ?? [];
  const components = spec.components ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const set = (next: CorridorComponent[]) => onChange({ ...spec, components: next });
  const patch = (i: number, p: Partial<CorridorComponent>) => set(components.map((c, k) => (k === i ? { ...c, ...p } : c)));
  const range = (): [number, number] => {
    try {
      const a = buildAlignment(spec.alignment);
      return [a.startStation, a.endStation];
    } catch {
      return [0, 100];
    }
  };
  const add = () => {
    const profile = library[0];
    if (!profile) { openProfileLibrary(); return; }
    const [from, to] = range();
    set([...components, componentFromProfile(freshProjectId('comp'), profile, from, to)]);
  };
  const choose = (i: number, profileId: string) => {
    const profile = library.find((p) => p.id === profileId);
    if (!profile) return;
    const c = components[i];
    set(components.map((x, k) => (k === i ? { ...componentFromProfile(c.id, profile, c.from, c.to), offset: c.offset } : x)));
  };
  return (
    <Section title={t('civil.zone.components')}>
      {components.length === 0 ? <p className="text-2xs text-zinc-500">{t('civil.components.none')}</p> : null}
      {components.map((c, i) => {
        const canAuto = !!c.profile.preset && PROFILE_PRESETS[c.profile.preset.id].params.some((p) => p.key === 'height');
        const inLibrary = library.some((p) => p.id === c.profileId);
        return (
          <div key={c.id} className="space-y-1 rounded-md border border-zinc-200 p-1.5 dark:border-zinc-700">
            <div className="flex items-center gap-1">
              <span className="size-3 shrink-0 rounded-sm border border-zinc-400" style={{ background: c.profile.color }} />
              <select aria-label={t('civil.components.profile')} className={INPUT} value={inLibrary ? c.profileId : ''} onChange={(e) => choose(i, e.target.value)}>
                {!inLibrary ? <option value="">{c.profile.name}</option> : null}
                {library.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <IconButton label={t('civil.components.refresh')} className="size-6" disabled={!inLibrary} onClick={() => choose(i, c.profileId)}><RefreshCw className="size-3" /></IconButton>
              <IconButton label={t('civil.components.edit')} className="size-6" aria-pressed={editing === c.id} onClick={() => setEditing(editing === c.id ? null : c.id)}><Pencil className="size-3" /></IconButton>
              <IconButton label={t('civil.row.remove')} className="size-6" onClick={() => set(components.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton>
            </div>
            {editing !== c.id ? (
              <div className="flex justify-center"><ProfileCanvas profile={c.profile} width={260} height={90} /></div>
            ) : (
              <ComponentProfileEditor component={c} onChange={(next) => set(components.map((x, k) => (k === i ? next : x)))} />
            )}
            <div className="grid grid-cols-3 gap-1">
              <select aria-label={t('civil.components.side')} className={INPUT} value={c.side} onChange={(e) => patch(i, { side: e.target.value as ComponentSide })}>
                {SIDES.map((x) => <option key={x} value={x}>{t(`civil.components.side.${x}`)}</option>)}
              </select>
              <select aria-label={t('civil.components.attach')} className={INPUT} value={c.attach} onChange={(e) => patch(i, { attach: e.target.value as ComponentAttach })}>
                {ATTACH.map((x) => <option key={x} value={x}>{t(`civil.components.attach.${x}`)}</option>)}
              </select>
              <select aria-label={t('civil.components.daylight')} className={INPUT} value={c.daylight} onChange={(e) => patch(i, { daylight: e.target.value as ComponentDaylight })}>
                {DAYLIGHT.map((x) => <option key={x} value={x}>{t(`civil.components.daylight.${x}`)}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-4 items-center gap-1 text-2xs text-zinc-500">
              <span>{t('civil.components.from')}</span>
              <Cell label={t('civil.components.from')} value={c.from} onCommit={(from) => patch(i, { from })} />
              <span>{t('civil.components.to')}</span>
              <Cell label={t('civil.components.to')} value={c.to} onCommit={(to) => patch(i, { to })} />
              <span>{t('civil.components.dx')}</span>
              <Cell label={t('civil.components.dx')} value={c.offset[0]} onCommit={(dx) => patch(i, { offset: [dx, c.offset[1]] })} />
              <span>{t('civil.components.dy')}</span>
              <Cell label={t('civil.components.dy')} value={c.offset[1]} onCommit={(dy) => patch(i, { offset: [c.offset[0], dy] })} />
            </div>
            {canAuto ? (
              <label className="flex items-center gap-1.5 text-2xs">
                <input type="checkbox" checked={!!c.autoHeight} onChange={(e) => patch(i, { autoHeight: e.target.checked })} />
                {t('civil.components.autoHeight')}
              </label>
            ) : null}
          </div>
        );
      })}
      <div className="flex gap-1">
        <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={add}>
          <Plus className="size-3" />{t('civil.components.add')}
        </button>
        <button type="button" className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => openProfileLibrary()}>
          <BookOpen className="size-3" />{t('civil.components.openLibrary')}
        </button>
      </div>
    </Section>
  );
}
