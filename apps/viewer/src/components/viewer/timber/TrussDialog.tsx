/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The truss configurator: shape, pattern, rise, panels, overhang, the chord
 * and web sections and the timber class, with the truss drawn as it will be
 * built. Opened on a selected truss it rebuilds that truss (Apply); opened
 * with nothing selected it sets what the TRUSS tool draws next.
 */

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { TIMBER_GRADES, trussBars, trussProblem, type PlacedTrussSpec, type TimberTrussSpec, type TrussPattern, type TrussShape } from '@ifc-lite/create';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { applyTruss, selectedTruss, trussDefaults, type TrussRef } from '@/project/timber-trusses';
import { INPUT, NumberField, Section } from '../joinery/JoineryFields';

/** Open on a truss (rebuild it), or on the TRUSS tool's defaults (`null` target). */
export const useTrussDialog = create<{ open: boolean; target: TrussRef | null }>()(() => ({ open: false, target: null }));

/** The configurator on the selected truss, or on the defaults when none is selected. */
export function openTrussDialog(): void {
  useTrussDialog.setState({ open: true, target: selectedTruss() });
}

const SHAPES: readonly TrussShape[] = ['pitched', 'mono', 'flat'];
const PATTERNS: readonly TrussPattern[] = ['fink', 'pratt', 'howe', 'warren', 'king', 'queen'];

function Preview({ spec }: { spec: TimberTrussSpec }) {
  const { t } = useTranslation();
  const bars = useMemo(() => { try { return trussBars(spec); } catch { return []; } }, [spec]);
  const W = 420, H = 200, pad = 16;
  const minX = -spec.overhang, maxX = spec.span + spec.overhang;
  const zs = bars.flatMap((b) => [b.a[1], b.b[1]]);
  const minZ = Math.min(0, ...zs), maxZ = Math.max(spec.rise, ...zs);
  const k = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxZ - minZ || 1));
  const x = (v: number) => pad + (v - minX) * k;
  const y = (v: number) => H - pad - (v - minZ) * k;
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800">
      <svg width={W} height={H} role="img" aria-label={t('truss.preview')}>
        {bars.map((b) => (
          <line key={b.key} x1={x(b.a[0])} y1={y(b.a[1])} x2={x(b.b[0])} y2={y(b.b[1])} stroke={b.role === 'web' || b.role === 'post' ? '#b07d3c' : '#7a4f1d'}
            strokeWidth={Math.max(1.5, b.section.depth * k * 0.6)} strokeLinecap="round" />
        ))}
      </svg>
      <figcaption className="text-2xs text-zinc-500">{t('truss.summary', { bars: bars.length, span: spec.span.toFixed(2) })}</figcaption>
    </figure>
  );
}

export function TrussDialog() {
  const { t } = useTranslation();
  const { open, target } = useTrussDialog();
  const [draft, setDraft] = useState<TimberTrussSpec & { name: string }>(() => ({ ...trussDefaults }));
  useEffect(() => {
    if (open) setDraft(target ? { ...target.spec } : { ...trussDefaults });
  }, [open, target]);
  const set = (patch: Partial<TimberTrussSpec & { name: string }>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = trussProblem(draft);
  const close = () => useTrussDialog.setState({ open: false, target: null });
  const apply = () => {
    if (problem) return;
    if (target) {
      const result = applyTruss(target, { ...target.spec, ...draft } as PlacedTrussSpec);
      if (result.ok) toast.success(t('truss.applied'));
      else toast.error(t('truss.failed', { reason: result.error }));
    } else {
      Object.assign(trussDefaults, draft);
      toast.success(t('truss.defaultsSet'));
    }
    close();
  };
  const section = (key: 'chord' | 'web') => (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label={t('truss.field.width')} value={draft[key].width} onChange={(v) => v && set({ [key]: { ...draft[key], width: v } })} />
      <NumberField label={t('truss.field.depth')} value={draft[key].depth} onChange={(v) => v && set({ [key]: { ...draft[key], depth: v } })} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[820px]">
        <DialogHeader><DialogTitle>{t(target ? 'truss.title.edit' : 'truss.title.defaults', { name: draft.name })}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-[22rem_1fr] gap-4 text-xs">
          <div className="space-y-2">
            <Section title={t('truss.zone.shape')}>
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('truss.field.name')}</span>
                <input className={INPUT} aria-label={t('truss.field.name')} defaultValue={draft.name} key={draft.name} onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} />
              </label>
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('truss.field.shape')}</span>
                <select className={INPUT} aria-label={t('truss.field.shape')} value={draft.shape} onChange={(e) => set({ shape: e.target.value as TrussShape })}>
                  {SHAPES.map((s) => <option key={s} value={s}>{t(`truss.shape.${s}` as TranslationKey)}</option>)}
                </select>
              </label>
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('truss.field.pattern')}</span>
                <select className={INPUT} aria-label={t('truss.field.pattern')} value={draft.pattern} onChange={(e) => set({ pattern: e.target.value as TrussPattern })}>
                  {PATTERNS.map((p) => <option key={p} value={p}>{t(`truss.pattern.${p}` as TranslationKey)}</option>)}
                </select>
              </label>
              <NumberField label={t('truss.field.rise')} value={draft.rise} onChange={(v) => v && set({ rise: v })} />
              <NumberField label={t('truss.field.panels')} value={draft.panels} plain onChange={(v) => v && set({ panels: Math.round(v) })} />
              <NumberField label={t('truss.field.overhang')} value={draft.overhang} onChange={(v) => v !== undefined && set({ overhang: v })} />
              {target ? null : <NumberField label={t('truss.field.span')} value={draft.span} onChange={(v) => v && set({ span: v })} />}
            </Section>
            <Section title={t('truss.zone.chords')}>{section('chord')}</Section>
            <Section title={t('truss.zone.webs')}>{section('web')}</Section>
            <Section title={t('truss.zone.timber')}>
              <select className={INPUT} aria-label={t('truss.field.grade')} value={draft.grade} onChange={(e) => set({ grade: e.target.value })}>
                {TIMBER_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Section>
          </div>
          <div className="space-y-2">
            {problem ? <p role="alert" className="rounded-sm bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{problem}</p> : <Preview spec={draft} />}
            <p className="text-2xs text-zinc-500">{t(target ? 'truss.hint.edit' : 'truss.hint.defaults')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={close}>{t('truss.close')}</Button>
          <Button size="sm" disabled={!!problem} onClick={apply}>{t(target ? 'truss.apply' : 'truss.useForNew')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
