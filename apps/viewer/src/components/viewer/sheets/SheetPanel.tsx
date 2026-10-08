/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The sheet's side panel: paper size and orientation, title-block fields,
 * the selected viewport's scale and crop size, and export.
 */

import { Download, Printer, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { removeViewport, setTitleBlockField, SHEET_SCALES, updateSheet, updateViewport } from '@/project/sheets';
import type { PaperSize, ProjectSheet, SheetViewport } from '@/project/types';

const INPUT = 'w-36 h-6 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1';
const PAPERS: PaperSize[] = ['A0', 'A1', 'A2', 'A3', 'A4'];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <Row label={label}>
      <input aria-label={label} className={INPUT} defaultValue={value} key={value} onBlur={(e) => e.target.value !== value && onCommit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </Row>
  );
}

interface SheetPanelProps {
  sheet: ProjectSheet;
  viewport: SheetViewport | null;
  /** The viewport's effective box (its own, or fitted to the drawing). */
  box: { width: number; height: number } | null;
  viewportName: string;
  onExportSvg: () => void;
  onPrint: () => void;
  onExportDxf: () => void;
}

export function SheetPanel({ sheet, viewport, box, viewportName, onExportSvg, onPrint, onExportDxf }: SheetPanelProps) {
  const { t } = useTranslation();
  const tb = sheet.titleBlock ?? {};
  return (
    <aside aria-label={t('sheets.panel')} className="w-64 shrink-0 overflow-y-auto border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3 space-y-2 text-xs">
      <h3 className="font-bold uppercase tracking-wider">{t('sheets.paper')}</h3>
      <Row label={t('sheets.size')}>
        <select aria-label={t('sheets.size')} className={INPUT} value={sheet.paper ?? 'A1'} onChange={(e) => updateSheet(sheet.id, { paper: e.target.value as PaperSize })}>
          {PAPERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Row>
      <Row label={t('sheets.orientation')}>
        <select aria-label={t('sheets.orientation')} className={INPUT} value={sheet.orientation ?? 'landscape'} onChange={(e) => updateSheet(sheet.id, { orientation: e.target.value === 'portrait' ? 'portrait' : 'landscape' })}>
          <option value="landscape">{t('sheets.landscape')}</option>
          <option value="portrait">{t('sheets.portrait')}</option>
        </select>
      </Row>
      <h3 className="pt-2 font-bold uppercase tracking-wider">{t('sheets.titleBlock')}</h3>
      <TextField label={t('sheets.tb.number')} value={sheet.number} onCommit={(v) => v.trim() && updateSheet(sheet.id, { number: v.trim() })} />
      <TextField label={t('sheets.tb.title')} value={sheet.name} onCommit={(v) => v.trim() && updateSheet(sheet.id, { name: v.trim() })} />
      <TextField label={t('sheets.tb.project')} value={tb.project ?? ''} onCommit={(v) => setTitleBlockField(sheet.id, 'project', v)} />
      <TextField label={t('sheets.tb.drawnBy')} value={tb.drawnBy ?? ''} onCommit={(v) => setTitleBlockField(sheet.id, 'drawnBy', v)} />
      <TextField label={t('sheets.tb.date')} value={tb.date ?? ''} onCommit={(v) => setTitleBlockField(sheet.id, 'date', v)} />
      {viewport ? (
        <>
          <h3 className="pt-2 font-bold uppercase tracking-wider">{t('sheets.viewport', { name: viewportName })}</h3>
          <Row label={t('sheets.scale')}>
            <select aria-label={t('sheets.scale')} className={INPUT} value={viewport.scale} onChange={(e) => updateViewport(sheet.id, viewport.id, { scale: Number(e.target.value) })}>
              {SHEET_SCALES.map((s) => <option key={s} value={s}>{`1:${s}`}</option>)}
            </select>
          </Row>
          <TextField label={t('sheets.width')} value={String(Math.round(box?.width ?? 0))} onCommit={(v) => Number(v) > 0 && updateViewport(sheet.id, viewport.id, { width: Number(v), height: box?.height ?? Number(v) })} />
          <TextField label={t('sheets.height')} value={String(Math.round(box?.height ?? 0))} onCommit={(v) => Number(v) > 0 && updateViewport(sheet.id, viewport.id, { height: Number(v), width: box?.width ?? Number(v) })} />
          <Button variant="outline" size="sm" className="w-full" onClick={() => updateViewport(sheet.id, viewport.id, { width: 0, height: 0 })}>{t('sheets.fitBox')}</Button>
          <Button variant="outline" size="sm" className="w-full" onClick={() => removeViewport(sheet.id, viewport.id)}>
            <Trash2 className="size-3.5 mr-1" />{t('sheets.removeViewport')}
          </Button>
        </>
      ) : <p className="pt-2 text-zinc-500">{t('sheets.dropHint')}</p>}
      <h3 className="pt-2 font-bold uppercase tracking-wider">{t('sheets.export')}</h3>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onExportSvg}><Download className="size-3.5 mr-1" />{t('sheets.svg')}</Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={onExportDxf}><Download className="size-3.5 mr-1" />{t('sheets.dxf')}</Button>
        <Button variant="outline" size="sm" className="w-full" onClick={onPrint}><Printer className="size-3.5 mr-1" />{t('sheets.pdf')}</Button>
      </div>
    </aside>
  );
}
