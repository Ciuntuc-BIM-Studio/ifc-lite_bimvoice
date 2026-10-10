/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The selected element's placement, in edit mode:
 *
 * - Storey: pick another storey of its model and the element (with the rest
 *   of the selection, a group's members, a roof system's or corridor's
 *   parts) moves there. By default it keeps its place relative to the storey
 *   and so moves with the level; "Keep in space" leaves it where it is;
 * - its offsets X, Y, Z and its angles about X, Y, Z in its parent's frame
 *   (the storey's, or its host's for a door in a wall), applied together.
 */

import { can } from '@/edition';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { elementPlacement, moveToStorey, selectionByModel, setPlacement, storeysOf } from '@/project/element-relocate';
import type { PlacementTransform } from '@ifc-lite/create';

const CELL = 'h-7 w-full rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1.5 text-xs tabular-nums';
const KEYS = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const;
type Key = (typeof KEYS)[number];

const show = (k: Key, v: number) => (k.startsWith('r') ? (Math.round(v * 1000) / 1000) : (Math.round(v * 10000) / 10000)).toString();

/** An element's placement is modelling: the docs edition shows no card. */
export function PlacementCard(props: { modelId: string; expressId: number }) {
  return can('modelling') ? <PlacementCardBody {...props} /> : null;
}

function PlacementCardBody({ modelId, expressId }: { modelId: string; expressId: number }) {
  const { t } = useTranslation();
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const placement = useMemo(() => elementPlacement(modelId, expressId), [modelId, expressId, mutationVersion]);
  const storeys = useMemo(() => storeysOf(modelId), [modelId, mutationVersion]);
  const [text, setText] = useState<Record<Key, string> | null>(null);
  const [keepWorld, setKeepWorld] = useState(false);
  useEffect(() => setText(null), [placement]);
  if (!placement) return <p className="mb-3 text-xs text-zinc-500">{t('placement.none')}</p>;
  const values: Record<Key, string> = text ?? Object.fromEntries(KEYS.map((k) => [k, show(k, placement[k])])) as Record<Key, string>;
  const parsed = KEYS.map((k) => Number(values[k].trim().replace(',', '.')));
  const changed = text !== null && parsed.every(Number.isFinite);
  const apply = () => {
    const next = Object.fromEntries(KEYS.map((k, i) => [k, parsed[i]])) as unknown as PlacementTransform;
    if (setPlacement(modelId, expressId, next)) toast.success(t('placement.applied'));
  };
  const toStorey = (storeyId: number) => {
    const ids = selectionByModel().get(modelId) ?? [];
    const result = moveToStorey(modelId, ids.includes(expressId) ? ids : [expressId], storeyId, keepWorld ? 'world' : 'storey');
    const name = storeys.find((s) => s.expressId === storeyId)?.name ?? `#${storeyId}`;
    if (result.ok) toast.success(t('relocate.moved', { count: result.moved, storey: name }));
  };
  return (
    <section className="mb-3 space-y-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700" aria-label={t('placement.title')}>
      <div className="text-2xs font-semibold uppercase tracking-wide text-zinc-500">{t('placement.title')}</div>
      <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
        <span className="text-zinc-500">{t('placement.storey')}</span>
        <select aria-label={t('placement.storey')} className={CELL} value={placement.storeyId ?? ''} onChange={(e) => toStorey(Number(e.target.value))}>
          {placement.storeyId === null ? <option value="">—</option> : null}
          {storeys.map((s) => <option key={s.expressId} value={s.expressId}>{t('relocate.storeyOption', { name: s.name, elevation: s.elevation.toFixed(2) })}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-1.5 text-2xs text-zinc-600 dark:text-zinc-400" title={t('placement.keepWorldHint')}>
        <input type="checkbox" checked={keepWorld} onChange={(e) => setKeepWorld(e.target.checked)} />
        {t('placement.keepWorld')}
      </label>
      <p className="text-2xs text-zinc-500">
        {placement.onStorey ? t('placement.relativeTo.storey') : t('placement.relativeTo.parent', { id: placement.parentPlacementId ?? '—' })}
      </p>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1">
        {KEYS.map((k) => (
          <label key={k} className="space-y-0.5">
            <span className="block text-2xs text-zinc-500">{t(`placement.${k}`)}</span>
            <input className={CELL} inputMode="decimal" aria-label={t(`placement.${k}`)} value={values[k]}
              onChange={(e) => setText({ ...values, [k]: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && changed) apply(); if (e.key === 'Escape') setText(null); }} />
          </label>
        ))}
      </div>
      <div className="flex gap-1">
        <Button size="sm" disabled={!changed} onClick={apply}>{t('placement.apply')}</Button>
        <Button size="sm" variant="ghost" disabled={!placement.rx && !placement.ry && !placement.rz && !text}
          onClick={() => setText({ ...values, rx: '0', ry: '0', rz: '0' })}>{t('placement.reset')}</Button>
      </div>
    </section>
  );
}
