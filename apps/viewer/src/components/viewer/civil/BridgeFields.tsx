/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The corridor's bridges: each one's station range, its deck (a library
 * profile, offset from the axis and turned by a cross-fall in its own
 * plane), and an abutment at either end — a library profile (the wall and
 * gravity presets, or any drawn one), edited in place like a component's,
 * how far it reaches left and right of the alignment, whether its height
 * follows the ground, its continuous footing, and Mirror to turn it round.
 */

import { useState } from 'react';
import { FlipHorizontal2, Pencil, Plus, Trash2 } from 'lucide-react';
import { abutmentProfile, type AbutmentSpec, type CorridorBridge, type CorridorSpec, type StructureProfile } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { useProjectStore } from '@/project/project-store';
import { newBridge } from '@/civil/bridge-defaults';
import { INPUT, Section } from '../joinery/JoineryFields';
import { Cell } from './CorridorFields';
import { ProfileCanvas } from './ProfileCanvas';
import { ComponentProfileEditor } from './ComponentProfileEditor';

interface Props {
  spec: CorridorSpec;
  onChange: (spec: CorridorSpec) => void;
}

function Num({ label, value, onCommit, min = 0, disabled }: { label: string; value: number | undefined; onCommit: (v: number) => void; min?: number; disabled?: boolean }) {
  return (
    <label className="grid grid-cols-[1fr_4.5rem] items-center gap-1 text-2xs">
      <span className="truncate text-zinc-500">{label}</span>
      <Cell label={label} value={value} min={min} onCommit={onCommit} disabled={disabled} />
    </label>
  );
}

/** A library profile choice for a deck or an abutment, its preview, and its in-place editor. */
function ProfilePick({ label, profileId, profile, choices, onChange, extra }: {
  label: string; profileId: string; profile: StructureProfile; choices: StructureProfile[];
  onChange: (profileId: string, profile: StructureProfile) => void; extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const inList = choices.some((p) => p.id === profileId);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <select aria-label={label} className={INPUT} value={inList ? profileId : ''}
          onChange={(e) => { const p = choices.find((x) => x.id === e.target.value); if (p) onChange(p.id, structuredClone(p)); }}>
          {!inList ? <option value="">{profile.name}</option> : null}
          {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {extra}
        <IconButton label={`${label}: ${t('civil.components.edit')}`} className="size-6" aria-pressed={editing} onClick={() => setEditing(!editing)}><Pencil className="size-3" /></IconButton>
      </div>
      {editing
        ? <ComponentProfileEditor profileId={profileId} profile={profile} onChange={onChange} />
        : <div className="flex justify-center"><ProfileCanvas profile={profile} width={300} height={110} /></div>}
    </div>
  );
}

function AbutmentFields({ title, a, choices, onChange }: { title: string; a: AbutmentSpec; choices: StructureProfile[]; onChange: (a: AbutmentSpec) => void }) {
  const { t } = useTranslation();
  const set = (p: Partial<AbutmentSpec>) => onChange({ ...a, ...p });
  const footing = (p: Partial<AbutmentSpec['footing']>) => set({ footing: { ...a.footing, ...p } });
  const auto = a.autoHeight ?? true;
  return (
    <div className="space-y-1 rounded-sm bg-zinc-50 p-1.5 dark:bg-zinc-900">
      <span className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{title}</span>
      <ProfilePick label={`${title} ${t('civil.bridge.profile')}`} profileId={a.profileId} profile={abutmentProfile(a)} choices={choices}
        onChange={(profileId, profile) => set({ profileId, profile })}
        extra={(
          <IconButton label={`${title}: ${t('civil.components.mirror')}`} className="size-6" aria-pressed={!!a.mirror} onClick={() => set({ mirror: !a.mirror })}>
            <FlipHorizontal2 className={`size-3 ${a.mirror ? 'text-primary' : ''}`} />
          </IconButton>
        )} />
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <Num label={t('civil.bridge.left')} value={a.left} onCommit={(left) => set({ left })} />
        <Num label={t('civil.bridge.right')} value={a.right} onCommit={(right) => set({ right })} />
        <label className="col-span-2 flex items-center gap-1.5 text-2xs">
          <input type="checkbox" checked={auto} onChange={(e) => set({ autoHeight: e.target.checked })} />
          {t('civil.bridge.autoHeight')}
        </label>
        <Num label={t('civil.bridge.footingWidth')} value={a.footing.width} min={0.5} onCommit={(width) => footing({ width })} />
        <Num label={t('civil.bridge.footingThickness')} value={a.footing.thickness} min={0.2} onCommit={(thickness) => footing({ thickness })} />
        <Num label={t('civil.bridge.footingToe')} value={a.footing.toe} onCommit={(toe) => footing({ toe })} />
      </div>
    </div>
  );
}

export function BridgeFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  const library = useProjectStore((s) => s.structureProfiles) ?? [];
  const decks = library.filter((p) => p.kind === 'bridge-deck');
  const abutments = library.filter((p) => p.kind === 'abutment');
  const bridges = spec.bridges ?? [];
  const set = (next: CorridorBridge[]) => onChange({ ...spec, bridges: next });
  const patch = (i: number, p: Partial<CorridorBridge>) => set(bridges.map((b, k) => (k === i ? { ...b, ...p } : b)));
  return (
    <Section title={t('civil.zone.bridges')}>
      {bridges.length === 0 ? <p className="text-2xs text-zinc-500">{t('civil.bridge.none')}</p> : null}
      {bridges.map((b, i) => (
        <div key={b.id} className="space-y-1.5 rounded-md border border-zinc-200 p-1.5 dark:border-zinc-700">
          <div className="flex items-center gap-1">
            <input aria-label={t('civil.bridge.name')} className={INPUT} defaultValue={b.name} key={b.name} onBlur={(e) => e.target.value.trim() && patch(i, { name: e.target.value.trim() })} />
            <IconButton label={t('civil.row.remove')} className="size-6" onClick={() => set(bridges.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <Num label={t('civil.components.from')} value={b.from} min={-Infinity} onCommit={(from) => patch(i, { from })} />
            <Num label={t('civil.components.to')} value={b.to} min={-Infinity} onCommit={(to) => patch(i, { to })} />
          </div>
          <span className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{t('civil.bridge.deck')}</span>
          <ProfilePick label={t('civil.bridge.deck')} profileId={b.deck.profileId} profile={b.deck.profile} choices={decks.length ? decks : library}
            onChange={(profileId, profile) => patch(i, { deck: { ...b.deck, profileId, profile } })} />
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <Num label={t('civil.components.dx')} value={b.deck.offset[0]} min={-Infinity} onCommit={(dx) => patch(i, { deck: { ...b.deck, offset: [dx, b.deck.offset[1]] } })} />
            <Num label={t('civil.components.dy')} value={b.deck.offset[1]} min={-Infinity} onCommit={(dy) => patch(i, { deck: { ...b.deck, offset: [b.deck.offset[0], dy] } })} />
            <Num label={t('civil.components.tilt')} value={b.deck.tilt ?? 0} min={-Infinity} onCommit={(tilt) => patch(i, { deck: { ...b.deck, tilt: tilt || undefined } })} />
          </div>
          <AbutmentFields title={t('civil.bridge.start')} a={b.start} choices={abutments} onChange={(start) => patch(i, { start })} />
          <AbutmentFields title={t('civil.bridge.end')} a={b.end} choices={abutments} onChange={(end) => patch(i, { end })} />
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        onClick={() => set([...bridges, newBridge(spec, t('civil.bridge.newName', { n: bridges.length + 1 }))])}>
        <Plus className="size-3" />{t('civil.bridge.add')}
      </button>
    </Section>
  );
}
