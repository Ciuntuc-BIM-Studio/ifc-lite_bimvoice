/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The corridor's bridges: each one's station range, its deck (a library
 * profile, offset from the axis), and an abutment at either end — wall or
 * gravity type, how far it reaches left and right of the alignment, its
 * height (from the terrain, or typed), stem / base / back-wall thickness,
 * its continuous footing, and Mirror to turn it round.
 */

import { FlipHorizontal2, Plus, Trash2 } from 'lucide-react';
import { assemblyWidth, buildAlignment, defaultAbutment, profileFromPreset, type AbutmentSpec, type AbutmentType, type CorridorBridge, type CorridorSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import { INPUT, Section } from '../joinery/JoineryFields';
import { Cell } from './CorridorFields';

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

function AbutmentFields({ title, a, onChange }: { title: string; a: AbutmentSpec; onChange: (a: AbutmentSpec) => void }) {
  const { t } = useTranslation();
  const set = (p: Partial<AbutmentSpec>) => onChange({ ...a, ...p });
  const footing = (p: Partial<AbutmentSpec['footing']>) => set({ footing: { ...a.footing, ...p } });
  return (
    <div className="space-y-1 rounded-sm bg-zinc-50 p-1.5 dark:bg-zinc-900">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-2xs font-semibold uppercase tracking-wide text-zinc-500">{title}</span>
        <select aria-label={`${title} ${t('civil.bridge.type')}`} className={`${INPUT} w-36`} value={a.type}
          onChange={(e) => { const next = defaultAbutment(e.target.value as AbutmentType, a.left); onChange({ ...next, left: a.left, right: a.right, height: a.height, mirror: a.mirror }); }}>
          <option value="wall">{t('civil.bridge.type.wall')}</option>
          <option value="gravity">{t('civil.bridge.type.gravity')}</option>
        </select>
        <IconButton label={`${title}: ${t('civil.components.mirror')}`} className="size-6" aria-pressed={!!a.mirror} onClick={() => set({ mirror: !a.mirror })}>
          <FlipHorizontal2 className={`size-3 ${a.mirror ? 'text-primary' : ''}`} />
        </IconButton>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <Num label={t('civil.bridge.left')} value={a.left} onCommit={(left) => set({ left })} />
        <Num label={t('civil.bridge.right')} value={a.right} onCommit={(right) => set({ right })} />
        <label className="col-span-2 flex items-center gap-1.5 text-2xs">
          <input type="checkbox" checked={a.height === undefined} onChange={(e) => set({ height: e.target.checked ? undefined : 6 })} />
          {t('civil.bridge.autoHeight')}
        </label>
        {a.height !== undefined ? <Num label={t('civil.bridge.height')} value={a.height} min={0.5} onCommit={(height) => set({ height })} /> : null}
        <Num label={t('civil.bridge.stem')} value={a.stem} min={0.2} onCommit={(stem) => set({ stem })} />
        {a.type === 'gravity' ? <Num label={t('civil.bridge.base')} value={a.base} min={0.2} onCommit={(base) => set({ base })} /> : null}
        <Num label={t('civil.bridge.backwall')} value={a.backwall} min={0.15} onCommit={(backwall) => set({ backwall })} />
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
  const bridges = spec.bridges ?? [];
  const set = (next: CorridorBridge[]) => onChange({ ...spec, bridges: next });
  const patch = (i: number, p: Partial<CorridorBridge>) => set(bridges.map((b, k) => (k === i ? { ...b, ...p } : b)));
  const add = () => {
    let from = 0, to = 50;
    try {
      const a = buildAlignment(spec.alignment);
      from = Math.round(a.startStation + a.length / 3);
      to = Math.round(a.startStation + (2 * a.length) / 3);
    } catch { /* an invalid alignment is reported by the preview */ }
    const half = Math.ceil(assemblyWidth(spec.assembly) + 0.5);
    const profile = decks[0] ? structuredClone(decks[0]) : profileFromPreset('deck-slab', freshProjectId('profile'));
    const depth = spec.assembly.layers.reduce((s, l) => s + l.thickness, 0);
    set([...bridges, {
      id: freshProjectId('bridge'), name: t('civil.bridge.newName', { n: bridges.length + 1 }), from, to,
      deck: { profileId: profile.id, profile, offset: [0, -Math.round(depth * 100) / 100] },
      start: defaultAbutment('wall', half), end: defaultAbutment('wall', half),
    }]);
  };
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
          <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-2xs">
            <span className="text-zinc-500">{t('civil.bridge.deck')}</span>
            <select aria-label={t('civil.bridge.deck')} className={INPUT} value={library.some((p) => p.id === b.deck.profileId) ? b.deck.profileId : ''}
              onChange={(e) => { const p = library.find((x) => x.id === e.target.value); if (p) patch(i, { deck: { ...b.deck, profileId: p.id, profile: structuredClone(p) } }); }}>
              {!library.some((p) => p.id === b.deck.profileId) ? <option value="">{b.deck.profile.name}</option> : null}
              {(decks.length ? decks : library).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <Num label={t('civil.components.dx')} value={b.deck.offset[0]} min={-Infinity} onCommit={(dx) => patch(i, { deck: { ...b.deck, offset: [dx, b.deck.offset[1]] } })} />
            <Num label={t('civil.components.dy')} value={b.deck.offset[1]} min={-Infinity} onCommit={(dy) => patch(i, { deck: { ...b.deck, offset: [b.deck.offset[0], dy] } })} />
          </div>
          <AbutmentFields title={t('civil.bridge.start')} a={b.start} onChange={(start) => patch(i, { start })} />
          <AbutmentFields title={t('civil.bridge.end')} a={b.end} onChange={(end) => patch(i, { end })} />
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={add}>
        <Plus className="size-3" />{t('civil.bridge.add')}
      </button>
    </Section>
  );
}
