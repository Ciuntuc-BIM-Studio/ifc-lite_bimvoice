/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The timber-frame dialog: the studs (width, spacing), the head plates, the
 * nogging rows, the header depth over openings, the boards on each face
 * (material, thickness, or none) and the timber class. Apply frames the
 * selected walls with it (or changes their frame); Remove frame takes it
 * off. Opened on a framed wall it starts from that wall's frame.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { TIMBER_GRADES, type TimberFrameSpec } from '@ifc-lite/create';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { frameDefaults, frameSelectedWalls, selectedFrame, selectedWallsByModel } from '@/project/timber-frames';
import { INPUT, NumberField, Section } from '../joinery/JoineryFields';

export const useTimberFrameDialog = create<{ open: boolean; walls: number }>()(() => ({ open: false, walls: 0 }));

export function openTimberFrameDialog(): void {
  const walls = [...selectedWallsByModel().values()].reduce((n, ids) => n + ids.length, 0);
  useTimberFrameDialog.setState({ open: true, walls });
}

type Board = 'sheathing' | 'lining';

export function TimberFrameDialog() {
  const { t } = useTranslation();
  const { open, walls } = useTimberFrameDialog();
  const [draft, setDraft] = useState<TimberFrameSpec>(() => structuredClone(frameDefaults));
  useEffect(() => { if (open) setDraft(structuredClone(selectedFrame() ?? frameDefaults)); }, [open]);
  const set = (patch: Partial<TimberFrameSpec>) => setDraft((d) => ({ ...d, ...patch }));
  const close = () => useTimberFrameDialog.setState({ open: false });
  const run = (spec: TimberFrameSpec | null) => {
    if (spec) Object.assign(frameDefaults, structuredClone(spec));
    const report = frameSelectedWalls(spec);
    if (report.refused) toast.error(t('timberFrame.failed', { reason: report.refused }));
    if (report.walls) toast.success(t(spec ? 'timberFrame.applied' : 'timberFrame.removed', { count: report.walls }));
    close();
  };
  const board = (key: Board) => {
    const b = draft[key];
    return (
      <Section title={t(`timberFrame.zone.${key}`)}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={b !== null} onChange={(e) => set({ [key]: e.target.checked ? { material: key === 'sheathing' ? 'OSB' : 'Gypsum board', thickness: key === 'sheathing' ? 0.015 : 0.0125 } : null })} />
          {t('timberFrame.board.on')}
        </label>
        {b ? (
          <>
            <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
              <span className="text-zinc-600 dark:text-zinc-400">{t('timberFrame.board.material')}</span>
              <input className={INPUT} aria-label={t('timberFrame.board.material')} defaultValue={b.material} key={b.material} onBlur={(e) => e.target.value.trim() && set({ [key]: { ...b, material: e.target.value.trim() } })} />
            </label>
            <NumberField label={t('timberFrame.board.thickness')} value={b.thickness} onChange={(v) => v && set({ [key]: { ...b, thickness: v } })} />
          </>
        ) : null}
      </Section>
    );
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader><DialogTitle>{t('timberFrame.title')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <Section title={t('timberFrame.zone.framing')}>
              <NumberField label={t('timberFrame.field.studWidth')} value={draft.studWidth} onChange={(v) => v && set({ studWidth: v })} />
              <NumberField label={t('timberFrame.field.spacing')} value={draft.spacing} onChange={(v) => v && set({ spacing: v })} />
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('timberFrame.field.headPlates')}</span>
                <select className={INPUT} aria-label={t('timberFrame.field.headPlates')} value={draft.headPlates} onChange={(e) => set({ headPlates: e.target.value === '1' ? 1 : 2 })}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </label>
              <NumberField label={t('timberFrame.field.noggingRows')} value={draft.noggingRows} plain onChange={(v) => v !== undefined && set({ noggingRows: Math.max(0, Math.min(4, Math.round(v))) })} />
              <NumberField label={t('timberFrame.field.headerDepth')} value={draft.headerDepth} onChange={(v) => v && set({ headerDepth: v })} />
              <label className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-zinc-600 dark:text-zinc-400">{t('timberFrame.field.grade')}</span>
                <select className={INPUT} aria-label={t('timberFrame.field.grade')} value={draft.grade} onChange={(e) => set({ grade: e.target.value })}>
                  {TIMBER_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
            </Section>
          </div>
          <div className="space-y-2">
            {board('sheathing')}
            {board('lining')}
            <p className="text-2xs text-zinc-500">{t('timberFrame.hint')}</p>
          </div>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-2xs text-zinc-500">{t('timberFrame.selected', { count: walls })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="text-red-600" disabled={walls === 0} onClick={() => run(null)}>{t('timberFrame.remove')}</Button>
            <Button size="sm" variant="outline" onClick={close}>{t('timberFrame.close')}</Button>
            <Button size="sm" disabled={walls === 0} onClick={() => run(draft)}>{t('timberFrame.apply')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
