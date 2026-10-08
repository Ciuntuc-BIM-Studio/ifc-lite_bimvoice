/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The covering's build-up, outermost layer first: a row per layer — its
 * material name and thickness — to reorder, remove or add. Written to the
 * model as the covering planes' IfcMaterialLayerSet; the planes are as thick
 * as the layers together.
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { coveringLayers, coveringThickness, type RoofLayer, type RoofSystemSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { Num, CELL } from './RoofNum';

export function CoveringLayers({ spec, onChange }: { spec: RoofSystemSpec; onChange: (spec: RoofSystemSpec) => void }) {
  const { t } = useTranslation();
  const layers = coveringLayers(spec.covering);
  const set = (next: RoofLayer[]) => {
    if (next.length === 0) return;
    onChange({ ...spec, covering: { ...spec.covering, layers: next, thickness: next.reduce((s, l) => s + l.thickness, 0) } });
  };
  const patch = (i: number, p: Partial<RoofLayer>) => set(layers.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...layers];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set(next);
  };
  return (
    <div className="space-y-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="font-medium">{t('roof.layer.material')}</th>
            <th className="w-20 font-medium">{t('roof.layer.thickness')}</th>
            <th className="w-20" aria-label={t('roof.layer.actions')} />
          </tr>
        </thead>
        <tbody>
          {layers.map((l, i) => (
            <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
              <td>
                <input aria-label={`${t('roof.layer.material')} ${i + 1}`} className={CELL} defaultValue={l.name} key={`${i}:${l.name}`}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.name && patch(i, { name: e.target.value.trim() })} />
              </td>
              <td><Num label={`${t('roof.layer.thickness')} ${i + 1}`} value={l.thickness} scale={1000} onCommit={(v) => v > 0 && patch(i, { thickness: v })} /></td>
              <td className="flex justify-end">
                <IconButton label={t('roof.layer.up')} className="size-6" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3" /></IconButton>
                <IconButton label={t('roof.layer.down')} className="size-6" disabled={i === layers.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3" /></IconButton>
                <IconButton label={t('roof.layer.remove')} className="size-6" disabled={layers.length === 1} onClick={() => set(layers.filter((_, k) => k !== i))}><Trash2 className="size-3" /></IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-xs">
        <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          onClick={() => set([...layers, { name: t('roof.layer.new'), thickness: 0.02 }])}>
          <Plus className="size-3" />{t('roof.layer.add')}
        </button>
        <span className="tabular-nums text-zinc-500">{t('roof.layer.total', { mm: Math.round(coveringThickness(spec.covering) * 1000 * 10) / 10 })}</span>
      </div>
    </div>
  );
}
