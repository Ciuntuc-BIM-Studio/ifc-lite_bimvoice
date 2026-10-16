/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A foundation type's fields: a strip foundation's wall layers (one of them
 * the core on the axis), heights, footing and level; a pad footing's steps
 * and level. Lengths in millimetres; the level is signed (below the storey
 * is negative).
 */

import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { IconButton } from '@/components/ui/icon-button';
import { coreIndex } from '@ifc-lite/create';
import type { PadFootingTypeSpec, StripFoundationTypeSpec } from '@/element-types/spec';
import { Field, LayerTable, Mm } from './TypeFields';

const CELL = 'h-6 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 tabular-nums';

/** A signed length in millimetres (a level). */
function SignedMm({ label, value, onCommit }: { label: string; value: number; onCommit: (metres: number) => void }) {
  return (
    <input aria-label={label} className={CELL} inputMode="decimal" defaultValue={Math.round(value * 10000) / 10} key={value}
      onBlur={(e) => {
        const v = Number(e.target.value.replace(',', '.'));
        if (Number.isFinite(v)) onCommit(v / 1000);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

export function StripFoundationFields({ spec, onChange }: { spec: StripFoundationTypeSpec; onChange: (spec: StripFoundationTypeSpec) => void }) {
  const { t } = useTranslation();
  const core = coreIndex(spec.layers);
  const setCore = (i: number) => onChange({ ...spec, layers: spec.layers.map((l, k) => ({ ...l, core: k === i })) });
  return (
    <>
      <Field label={`${t('elementTypes.foundation.stemHeight')} (mm)`}>
        <Mm label={t('elementTypes.foundation.stemHeight')} value={spec.stemHeight} onCommit={(stemHeight) => onChange({ ...spec, stemHeight })} />
      </Field>
      <Field label={`${t('elementTypes.foundation.footingWidth')} (mm)`}>
        <Mm label={t('elementTypes.foundation.footingWidth')} value={spec.footingWidth} onCommit={(footingWidth) => onChange({ ...spec, footingWidth })} />
      </Field>
      <Field label={`${t('elementTypes.foundation.footingHeight')} (mm)`}>
        <Mm label={t('elementTypes.foundation.footingHeight')} value={spec.footingHeight} onCommit={(footingHeight) => onChange({ ...spec, footingHeight })} />
      </Field>
      <Field label={`${t('elementTypes.foundation.bottom')} (mm)`}>
        <SignedMm label={t('elementTypes.foundation.bottom')} value={spec.bottom} onCommit={(bottom) => onChange({ ...spec, bottom })} />
      </Field>
      <p className="text-zinc-500">{t('elementTypes.foundation.bottomHint')}</p>
      <Field label={t('elementTypes.foundation.core')}>
        <select aria-label={t('elementTypes.foundation.core')} className={CELL} value={core} onChange={(e) => setCore(Number(e.target.value))}>
          {spec.layers.map((l, i) => <option key={i} value={i}>{`${i + 1}. ${l.name}`}</option>)}
        </select>
      </Field>
      <LayerTable layers={spec.layers} caption={t('elementTypes.foundation.layers')}
        onChange={(layers) => {
          // The core stays the layer it was (by name) when layers move; else the thickest.
          const name = spec.layers[core]?.name;
          const at = layers.findIndex((l) => l.name === name);
          onChange({ ...spec, layers: layers.map((l, i) => ({ ...l, core: at >= 0 ? i === at : undefined })) });
        }} />
    </>
  );
}

export function PadFootingFields({ spec, onChange }: { spec: PadFootingTypeSpec; onChange: (spec: PadFootingTypeSpec) => void }) {
  const { t } = useTranslation();
  const patch = (i: number, p: Partial<PadFootingTypeSpec['steps'][number]>) => onChange({ ...spec, steps: spec.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const last = spec.steps[spec.steps.length - 1];
  return (
    <>
      <Field label={`${t('elementTypes.foundation.bottom')} (mm)`}>
        <SignedMm label={t('elementTypes.foundation.bottom')} value={spec.bottom} onCommit={(bottom) => onChange({ ...spec, bottom })} />
      </Field>
      <p className="text-zinc-500">{t('elementTypes.foundation.bottomHint')}</p>
      <p className="text-zinc-500">{t('elementTypes.foundation.steps')}</p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="w-10 font-medium">{t('elementTypes.foundation.step')}</th>
            <th className="font-medium">{t('elementTypes.foundation.length')}</th>
            <th className="font-medium">{t('elementTypes.foundation.width')}</th>
            <th className="font-medium">{t('elementTypes.foundation.height')}</th>
            <th className="w-8" aria-label={t('elementTypes.foundation.removeStep')} />
          </tr>
        </thead>
        <tbody>
          {spec.steps.map((s, i) => (
            <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="tabular-nums text-zinc-500">{i + 1}</td>
              <td><Mm label={`${t('elementTypes.foundation.length')} ${i + 1}`} value={s.length} onCommit={(length) => patch(i, { length })} /></td>
              <td><Mm label={`${t('elementTypes.foundation.width')} ${i + 1}`} value={s.width} onCommit={(width) => patch(i, { width })} /></td>
              <td><Mm label={`${t('elementTypes.foundation.height')} ${i + 1}`} value={s.height} onCommit={(height) => patch(i, { height })} /></td>
              <td className="flex justify-end">
                <IconButton label={t('elementTypes.foundation.removeStep')} className="size-6" disabled={spec.steps.length === 1}
                  onClick={() => onChange({ ...spec, steps: spec.steps.filter((_, k) => k !== i) })}><Trash2 className="size-3" /></IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="flex items-center gap-1 rounded-sm border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        // A new step on top, 200 mm smaller each way than the one under it.
        onClick={() => onChange({ ...spec, steps: [...spec.steps, { length: Math.max(0.2, last.length - 0.4), width: Math.max(0.2, last.width - 0.4), height: 0.3 }] })}>
        <Plus className="size-3" />{t('elementTypes.foundation.addStep')}
      </button>
    </>
  );
}

/** A pad footing seen from the side, its steps to scale. */
export function PadFootingPreview({ spec }: { spec: PadFootingTypeSpec }) {
  const W = 220, H = 160;
  const width = Math.max(...spec.steps.map((s) => s.length), 0.01);
  const height = spec.steps.reduce((sum, s) => sum + s.height, 0) || 0.01;
  const k = Math.min((W - 40) / width, (H - 40) / height);
  let z = 0;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="rounded-sm border border-zinc-200 dark:border-zinc-800" aria-hidden="true">
      {spec.steps.map((s, i) => {
        const y = H - 20 - (z + s.height) * k;
        z += s.height;
        return <rect key={i} x={W / 2 - (s.length * k) / 2} y={y} width={s.length * k} height={s.height * k} fill="#a8a8a8" stroke="currentColor" strokeWidth={0.5} />;
      })}
    </svg>
  );
}
