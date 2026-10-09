/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The assembly zone of the corridor configurator: lanes and shoulder of
 * one side (mirrored), the pavement courses with their colours, and the
 * daylight slopes.
 */

import { Plus, Trash2 } from 'lucide-react';
import type { AssemblySpec, CorridorSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { Section } from '../joinery/JoineryFields';
import { CELL, Cell } from './CorridorFields';

interface Props {
  spec: CorridorSpec;
  onChange: (spec: CorridorSpec) => void;
}

export function AssemblyFields({ spec, onChange }: Props) {
  const { t } = useTranslation();
  const a = spec.assembly;
  const set = (patch: Partial<AssemblySpec>) => onChange({ ...spec, assembly: { ...a, ...patch } });
  const lane = (i: number, p: Partial<AssemblySpec['lanes'][number]>) => set({ lanes: a.lanes.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const layer = (i: number, p: Partial<AssemblySpec['layers'][number]>) => set({ layers: a.layers.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  return (
    <>
      <Section title={t('civil.zone.assembly')}>
        <p className="text-xs text-zinc-500">{t('civil.field.lanes')}</p>
        <table className="w-full text-xs">
          <tbody>
            {a.lanes.map((l, i) => (
              <tr key={i}>
                <td><Cell label={`${t('civil.col.width')} ${i + 1}`} value={l.width} min={0.1} onCommit={(width) => lane(i, { width })} /></td>
                <td><Cell label={`${t('civil.col.slope')} ${i + 1}`} value={l.slope} onCommit={(slope) => lane(i, { slope })} /></td>
                <td className="w-7"><IconButton label={t('civil.row.remove')} className="size-6" disabled={a.lanes.length <= 1} onClick={() => set({ lanes: a.lanes.filter((_, k) => k !== i) })}><Trash2 className="size-3" /></IconButton></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={() => set({ lanes: [...a.lanes, { width: 3.5, slope: -2.5 }] })}>
          <Plus className="size-3" />{t('civil.row.add')}
        </button>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={a.shoulder !== null} onChange={(e) => set({ shoulder: e.target.checked ? { width: 1, slope: -4 } : null })} />
          {t('civil.field.shoulder')}
        </label>
        {a.shoulder ? (
          <div className="grid grid-cols-2 gap-1">
            <Cell label={`${t('civil.field.shoulder')} ${t('civil.col.width')}`} value={a.shoulder.width} min={0.1} onCommit={(width) => set({ shoulder: { ...a.shoulder!, width } })} />
            <Cell label={`${t('civil.field.shoulder')} ${t('civil.col.slope')}`} value={a.shoulder.slope} onCommit={(slope) => set({ shoulder: { ...a.shoulder!, slope } })} />
          </div>
        ) : null}
      </Section>
      <Section title={t('civil.zone.layers')}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="w-6" aria-label={t('civil.col.colour')} />
              <th className="font-medium">{t('civil.col.material')}</th>
              <th className="w-16 font-medium">{t('civil.col.thickness')}</th>
              <th className="w-7" aria-label={t('civil.col.actions')} />
            </tr>
          </thead>
          <tbody>
            {a.layers.map((l, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td><input type="color" aria-label={`${t('civil.col.colour')} ${i + 1}`} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" value={l.color} onChange={(e) => layer(i, { color: e.target.value })} /></td>
                <td><input aria-label={`${t('civil.col.material')} ${i + 1}`} className={CELL} defaultValue={l.name} key={`${i}:${l.name}`} onBlur={(e) => e.target.value.trim() && layer(i, { name: e.target.value.trim() })} /></td>
                <td><Cell label={`${t('civil.col.thickness')} ${i + 1}`} value={l.thickness} scale={1000} min={1} onCommit={(thickness) => layer(i, { thickness })} /></td>
                <td><IconButton label={t('civil.row.remove')} className="size-6" disabled={a.layers.length <= 1} onClick={() => set({ layers: a.layers.filter((_, k) => k !== i) })}><Trash2 className="size-3" /></IconButton></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={() => set({ layers: [...a.layers, { name: 'Course', thickness: 0.1, color: '#9a8f7a' }] })}>
          <Plus className="size-3" />{t('civil.row.add')}
        </button>
      </Section>
      <Section title={t('civil.zone.daylight')}>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="grid grid-cols-[auto_1fr] items-center gap-1"><span className="text-zinc-500">{t('civil.field.cutSlope')}</span><Cell label={t('civil.field.cutSlope')} value={a.daylight.cutSlope} min={0.1} onCommit={(cutSlope) => set({ daylight: { ...a.daylight, cutSlope } })} /></label>
          <label className="grid grid-cols-[auto_1fr] items-center gap-1"><span className="text-zinc-500">{t('civil.field.fillSlope')}</span><Cell label={t('civil.field.fillSlope')} value={a.daylight.fillSlope} min={0.1} onCommit={(fillSlope) => set({ daylight: { ...a.daylight, fillSlope } })} /></label>
        </div>
      </Section>
    </>
  );
}
