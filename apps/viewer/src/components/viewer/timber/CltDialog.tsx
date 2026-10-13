/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The CLT dialog: a cross-laminated timber wall or slab type — 3, 5 or 7
 * lamellae (each thickness editable), the timber class and a name — drawn as
 * its section, the grain alternating layer to layer. "Create type" adds it to
 * the project's element types as the current wall or slab type; "Create and
 * apply" also types the selected walls or slabs with it.
 */

import { useState } from 'react';
import { create } from 'zustand';
import { TIMBER_GRADES } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { elementType } from '@/element-types/catalog';
import { applyTypeToSelection } from '@/element-types/model-sync';
import { addCltType, cltName, CLT_LAYUPS, type CltKind, type CltSpec } from '@/project/clt';
import { INPUT, NumberField, Section } from '../joinery/JoineryFields';

export const useCltDialog = create<{ open: boolean }>()(() => ({ open: false }));
export const openCltDialog = () => useCltDialog.setState({ open: true });

function SectionPreview({ spec }: { spec: CltSpec }) {
  const { t } = useTranslation();
  const total = spec.layers.reduce((s, l) => s + l, 0);
  const W = 260, H = 150, k = (H - 20) / Math.max(total, 0.01);
  let y = 10;
  return (
    <figure className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800">
      <svg width={W} height={H} role="img" aria-label={t('clt.preview')}>
        <defs>
          <pattern id="clt-along" width="12" height="4" patternUnits="userSpaceOnUse"><path d="M0 2C3 1 6 3 12 2" stroke="#8a5a24" strokeWidth="0.8" fill="none" /></pattern>
          <pattern id="clt-across" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.4" stroke="#8a5a24" strokeWidth="0.6" fill="none" /></pattern>
        </defs>
        {spec.layers.map((l, i) => {
          const h = l * k;
          const rect = (
            <g key={i}>
              <rect x={10} y={y} width={W - 20} height={h} fill="#dcb986" stroke="#7a4f1d" strokeWidth={0.8} />
              <rect x={10} y={y} width={W - 20} height={h} fill={`url(#${i % 2 === 0 ? 'clt-along' : 'clt-across'})`} />
            </g>
          );
          y += h;
          return rect;
        })}
      </svg>
      <figcaption className="text-2xs text-zinc-500">{t('clt.summary', { mm: Math.round(total * 1000), count: spec.layers.length })}</figcaption>
    </figure>
  );
}

export function CltDialog() {
  const { t } = useTranslation();
  const open = useCltDialog((s) => s.open);
  const [spec, setSpec] = useState<CltSpec>({ kind: 'wall', layers: [...CLT_LAYUPS[5]], grade: 'C24' });
  const [name, setName] = useState('');
  const set = (patch: Partial<CltSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const close = () => useCltDialog.setState({ open: false });
  const create = (apply: boolean) => {
    try {
      const id = addCltType({ ...spec, name });
      const made = elementType(id);
      toast.success(t('clt.created', { name: made?.name ?? '' }));
      if (apply && made) {
        const report = applyTypeToSelection(made);
        if (report.updated) toast.success(t('clt.applied', { count: report.updated }));
        if (report.refused.length) toast.info(report.refused[0]);
      }
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader><DialogTitle>{t('clt.title')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <Section title={t('clt.zone.panel')}>
              <SegmentedControl size="sm" label={t('clt.field.kind')} value={spec.kind} onValueChange={(kind: CltKind) => set({ kind })}
                options={[{ value: 'wall', label: t('clt.kind.wall') }, { value: 'slab', label: t('clt.kind.slab') }]} />
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('clt.field.layers')}</span>
                <select className={INPUT} aria-label={t('clt.field.layers')} value={spec.layers.length} onChange={(e) => set({ layers: [...CLT_LAYUPS[Number(e.target.value) as 3 | 5 | 7]] })}>
                  {[3, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('clt.field.grade')}</span>
                <select className={INPUT} aria-label={t('clt.field.grade')} value={spec.grade} onChange={(e) => set({ grade: e.target.value })}>
                  {TIMBER_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('clt.field.name')}</span>
                <input className={INPUT} aria-label={t('clt.field.name')} placeholder={cltName(spec)} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            </Section>
            <Section title={t('clt.zone.lamellae')}>
              {spec.layers.map((l, i) => (
                <NumberField key={`${spec.layers.length}:${i}`} label={t(i % 2 === 0 ? 'clt.layer.along' : 'clt.layer.across', { n: i + 1 })} value={l}
                  onChange={(v) => v && set({ layers: spec.layers.map((x, k) => (k === i ? v : x)) })} />
              ))}
            </Section>
          </div>
          <div className="space-y-2">
            <SectionPreview spec={spec} />
            <p className="text-2xs text-zinc-500">{t('clt.hint')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={close}>{t('clt.close')}</Button>
          <Button size="sm" variant="outline" onClick={() => create(false)}>{t('clt.create')}</Button>
          <Button size="sm" onClick={() => create(true)}>{t('clt.createApply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
