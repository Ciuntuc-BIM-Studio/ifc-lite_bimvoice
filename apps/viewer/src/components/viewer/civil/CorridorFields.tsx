/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The corridor configurator's data zones: the corridor itself (name,
 * sampling, design speed, terrain), the horizontal alignment as a PI table
 * and the vertical profile as a PVI table — with a profile taken from the
 * terrain in one click.
 */

import { useState } from 'react';
import { buildAlignment, profileFromGround, Terrain, type CorridorSpec, type Tin } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { INPUT, Section } from '../joinery/JoineryFields';

export const CELL = 'h-7 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs tabular-nums';

/** A number cell, negative allowed, committed on Enter or blur; `scale` shows value × scale. */
export function Cell({ value, onCommit, label, scale = 1, min = -Infinity, disabled }: { value: number | undefined; onCommit: (v: number) => void; label: string; scale?: number; min?: number; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const n = Number(text.trim().replace(',', '.'));
    setText(null);
    if (Number.isFinite(n) && n >= min) onCommit(n / scale);
  };
  return (
    <input aria-label={label} className={CELL} disabled={disabled} inputMode="decimal" value={text ?? (value === undefined ? '' : String(Math.round(value * scale * 1000) / 1000))}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(null); }} />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[1fr_7rem] items-center gap-2 text-xs">
      <span className="truncate text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

interface Props {
  spec: CorridorSpec;
  onChange: (spec: CorridorSpec) => void;
}

export function GeneralFields({ spec, onChange, terrains }: Props & { terrains: { globalId: string; name: string }[] }) {
  const { t } = useTranslation();
  const design = (patch: Partial<CorridorSpec['design']>) => onChange({ ...spec, design: { ...spec.design, ...patch } });
  return (
    <Section title={t('civil.zone.general')}>
      <Row label={t('civil.field.name')}>
        <input className={INPUT} defaultValue={spec.name} key={spec.name} onBlur={(e) => e.target.value.trim() && onChange({ ...spec, name: e.target.value.trim() })} />
      </Row>
      <Row label={t('civil.field.interval')}><Cell label={t('civil.field.interval')} value={spec.interval} min={0.5} onCommit={(interval) => onChange({ ...spec, interval })} /></Row>
      <Row label={t('civil.field.designSpeed')}><Cell label={t('civil.field.designSpeed')} value={spec.design.designSpeed} min={10} onCommit={(designSpeed) => design({ designSpeed })} /></Row>
      <Row label={t('civil.field.maxSuperelevation')}><Cell label={t('civil.field.maxSuperelevation')} value={spec.design.maxSuperelevation} min={0} onCommit={(maxSuperelevation) => design({ maxSuperelevation })} /></Row>
      <Row label={t('civil.field.normalCrown')}><Cell label={t('civil.field.normalCrown')} value={spec.design.normalCrown} min={0} onCommit={(normalCrown) => design({ normalCrown })} /></Row>
      <Row label={t('civil.field.terrain')}>
        <select aria-label={t('civil.field.terrain')} className={INPUT} value={spec.terrainGlobalId ?? ''} onChange={(e) => onChange({ ...spec, terrainGlobalId: e.target.value || null })}>
          <option value="">{t('civil.field.noTerrain')}</option>
          {terrains.map((x) => <option key={x.globalId} value={x.globalId}>{x.name}</option>)}
        </select>
      </Row>
    </Section>
  );
}

export function AlignmentFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  const pis = spec.alignment.pis;
  const set = (next: CorridorSpec['alignment']['pis']) => onChange({ ...spec, alignment: { ...spec.alignment, pis: next } });
  const patch = (i: number, p: Partial<(typeof pis)[number]>) => set(pis.map((pi, k) => (k === i ? { ...pi, ...p } : pi)));
  const insert = (i: number) => {
    const a = pis[i], b = pis[Math.min(i + 1, pis.length - 1)];
    set([...pis.slice(0, i + 1), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, radius: 50 }, ...pis.slice(i + 1)]);
  };
  return (
    <Section title={t('civil.zone.alignment')}>
      <Row label={t('civil.field.startStation')}><Cell label={t('civil.field.startStation')} value={spec.alignment.startStation ?? 0} onCommit={(startStation) => onChange({ ...spec, alignment: { ...spec.alignment, startStation } })} /></Row>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="w-7 font-medium">{t('civil.col.pi')}</th>
            <th className="font-medium">{t('civil.col.x')}</th>
            <th className="font-medium">{t('civil.col.y')}</th>
            <th className="w-16 font-medium">{t('civil.col.radius')}</th>
            <th className="w-14 font-medium">{t('civil.col.spiralIn')}</th>
            <th className="w-14 font-medium">{t('civil.col.spiralOut')}</th>
            <th className="w-14" aria-label={t('civil.col.actions')} />
          </tr>
        </thead>
        <tbody>
          {pis.map((pi, i) => {
            const inner = i > 0 && i < pis.length - 1;
            return (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="tabular-nums text-zinc-500">{i}</td>
                <td><Cell label={`${t('civil.col.x')} ${i}`} value={pi.x} onCommit={(x) => patch(i, { x })} /></td>
                <td><Cell label={`${t('civil.col.y')} ${i}`} value={pi.y} onCommit={(y) => patch(i, { y })} /></td>
                <td><Cell label={`${t('civil.col.radius')} ${i}`} value={inner ? pi.radius ?? 0 : undefined} disabled={!inner} min={0} onCommit={(radius) => patch(i, { radius: radius || undefined })} /></td>
                <td><Cell label={`${t('civil.col.spiralIn')} ${i}`} value={inner ? pi.spiralIn ?? 0 : undefined} disabled={!inner} min={0} onCommit={(spiralIn) => patch(i, { spiralIn: spiralIn || undefined })} /></td>
                <td><Cell label={`${t('civil.col.spiralOut')} ${i}`} value={inner ? pi.spiralOut ?? 0 : undefined} disabled={!inner} min={0} onCommit={(spiralOut) => patch(i, { spiralOut: spiralOut || undefined })} /></td>
                <td className="flex justify-end">
                  <IconButton label={t('civil.row.insert')} className="size-6" disabled={i === pis.length - 1} onClick={() => insert(i)}><Plus className="size-3" /></IconButton>
                  <IconButton label={t('civil.row.remove')} className="size-6" disabled={pis.length <= 2} onClick={() => set(pis.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

export function ProfileFields({ spec, onChange, terrain }: Props & { terrain: Tin | null }) {
  const { t } = useTranslation();
  const pvis = spec.profile.pvis;
  const set = (next: CorridorSpec['profile']['pvis']) => onChange({ ...spec, profile: { pvis: next } });
  const patch = (i: number, p: Partial<(typeof pvis)[number]>) => set(pvis.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const add = () => {
    const last = pvis[pvis.length - 1];
    set([...pvis, { station: last.station + 100, elevation: last.elevation }]);
  };
  const fromTerrain = () => {
    if (!terrain) return;
    try {
      const a = buildAlignment(spec.alignment);
      const ground = new Terrain(terrain);
      set(profileFromGround(a.startStation, a.endStation, (s) => { const p = a.pointAt(s); return ground.elevationAt(p.x, p.y); }).pvis);
    } catch { /* an invalid alignment is reported by the preview */ }
  };
  const flat = () => {
    try {
      const a = buildAlignment(spec.alignment);
      const z = pvis[0]?.elevation ?? 0;
      set([{ station: a.startStation, elevation: z }, { station: a.endStation, elevation: z }]);
    } catch { /* idem */ }
  };
  return (
    <Section title={t('civil.zone.profile')}>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={!terrain} onClick={fromTerrain}>{t('civil.profileFromTerrain')}</Button>
        <Button size="sm" variant="ghost" onClick={flat}>{t('civil.profileFlat')}</Button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="font-medium">{t('civil.col.station')}</th>
            <th className="font-medium">{t('civil.col.elevation')}</th>
            <th className="w-16 font-medium">{t('civil.col.curve')}</th>
            <th className="w-7" aria-label={t('civil.col.actions')} />
          </tr>
        </thead>
        <tbody>
          {pvis.map((p, i) => {
            const inner = i > 0 && i < pvis.length - 1;
            return (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td><Cell label={`${t('civil.col.station')} ${i}`} value={p.station} onCommit={(station) => patch(i, { station })} /></td>
                <td><Cell label={`${t('civil.col.elevation')} ${i}`} value={p.elevation} onCommit={(elevation) => patch(i, { elevation })} /></td>
                <td><Cell label={`${t('civil.col.curve')} ${i}`} value={inner ? p.length ?? 0 : undefined} disabled={!inner} min={0} onCommit={(length) => patch(i, { length: length || undefined })} /></td>
                <td><IconButton label={t('civil.row.remove')} className="size-6" disabled={pvis.length <= 2} onClick={() => set(pvis.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={add}>
        <Plus className="size-3" />{t('civil.row.add')}
      </button>
    </Section>
  );
}
