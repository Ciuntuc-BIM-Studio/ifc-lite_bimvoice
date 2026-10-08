/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A joinery schedule tab: the list as it prints (paper millimetres, zoomable),
 * what it lists and at which scale its drawings are, and exports — CSV and
 * XLSX (types, and every element numbered) for a spreadsheet, SVG, DXF (with
 * layers). "Number elements" writes each element's number into its Tag.
 * Drag it from the Project Navigator onto a sheet to place it.
 */

import { useRef, useState } from 'react';
import { Download, Hash, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import type { ProjectSchedule } from '@/project/types';
import { updateSchedule } from '@/joinery/schedules';
import { openJoinery } from '@/joinery/dialog-store';
import { scheduleCsv } from '@/joinery/schedule-layout';
import { scheduleXlsx } from '@/joinery/schedule-xlsx';
import { writeOccurrenceNumbers } from '@/joinery/schedule-numbering';
import { toast } from '@/components/ui/toast';
import { svgToDxf } from '../sheets/sheet-dxf';
import { ScheduleGraphic, useScheduleLabels, useScheduleLayout } from './ScheduleGraphic';

const SELECT = 'h-7 rounded-sm border border-zinc-300 dark:border-zinc-700 bg-transparent px-1 text-xs';
const SCALES = [10, 20, 25, 50, 100];
const MARGIN = 10;

export function ScheduleView({ schedule }: { schedule: ProjectSchedule }) {
  const { t } = useTranslation();
  const result = useScheduleLayout(schedule);
  const labels = useScheduleLabels(schedule.name);
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(3);
  if (!result) return null;
  const { data, layout } = result;
  const w = layout.width + 2 * MARGIN, h = layout.height + 2 * MARGIN;
  const stem = sanitizeFilename(schedule.name, { fallback: 'schedule' });

  const exportSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', `${w}mm`);
    clone.setAttribute('height', `${h}mm`);
    downloadFile(`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`, `${stem}.svg`, 'image/svg+xml');
  };
  const exportXlsx = async () => {
    const blob = await scheduleXlsx(data, {
      ...labels, types: t('schedule.sheet.types'), elements: t('schedule.sheet.elements'),
      number: t('schedule.col.number'), level: t('schedule.col.level'), globalId: t('schedule.col.globalId'),
    });
    downloadFile(blob, `${stem}.xlsx`, blob.type);
  };
  const number = () => {
    const out = writeOccurrenceNumbers(data);
    if (out.errors.length) toast.error(out.errors.join('; '));
    else toast.success(t('schedule.numbered', { count: out.written }));
  };
  const exportDxf = () => {
    if (svgRef.current) downloadFile(svgToDxf(svgRef.current, h, `units: millimetres (paper), schedule ${schedule.name}`), `${stem}.dxf`, 'application/dxf');
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-200 px-2 text-xs dark:border-zinc-800">
        <span className="font-semibold">{schedule.name}</span>
        <select aria-label={t('schedule.kind')} className={SELECT} value={schedule.kind} onChange={(e) => updateSchedule(schedule.id, { kind: e.target.value as ProjectSchedule['kind'] })}>
          <option value="all">{t('joinery.filter.all')}</option>
          <option value="window">{t('joinery.filter.window')}</option>
          <option value="door">{t('joinery.filter.door')}</option>
        </select>
        <select aria-label={t('schedule.scale')} className={SELECT} value={schedule.scale ?? 50} onChange={(e) => updateSchedule(schedule.id, { scale: Number(e.target.value) })}>
          {SCALES.map((s) => <option key={s} value={s}>1:{s}</option>)}
        </select>
        <span className="text-zinc-500">{t('schedule.count', { types: data.entries.length, elements: data.entries.reduce((s, e) => s + e.total, 0) })}</span>
        <span className="flex-1" />
        <IconButton label={t('schedule.zoomOut')} className="size-7" onClick={() => setZoom((z) => Math.max(1, z / 1.25))}><Minus className="size-3.5" /></IconButton>
        <IconButton label={t('schedule.zoomIn')} className="size-7" onClick={() => setZoom((z) => Math.min(12, z * 1.25))}><Plus className="size-3.5" /></IconButton>
        <Button size="sm" variant="ghost" onClick={() => openJoinery()}><SlidersHorizontal className="mr-1 size-3.5" />{t('joinery.open')}</Button>
        <Button size="sm" variant="ghost" onClick={number} title={t('schedule.numberHint')}><Hash className="mr-1 size-3.5" />{t('schedule.number')}</Button>
        <Button size="sm" variant="outline" onClick={() => downloadFile(scheduleCsv(data, labels), `${stem}.csv`, 'text/csv')}><Download className="mr-1 size-3.5" />{t('schedule.export.csv')}</Button>
        <Button size="sm" variant="outline" onClick={() => void exportXlsx()}><Download className="mr-1 size-3.5" />{t('schedule.export.xlsx')}</Button>
        <Button size="sm" variant="outline" onClick={exportSvg}><Download className="mr-1 size-3.5" />{t('schedule.export.svg')}</Button>
        <Button size="sm" variant="outline" onClick={exportDxf}><Download className="mr-1 size-3.5" />{t('schedule.export.dxf')}</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-zinc-200 p-4 dark:bg-zinc-900">
        {data.entries.length === 0 ? <p className="p-4 text-sm text-zinc-500">{t('schedule.empty')}</p> : (
          <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={w * zoom} height={h * zoom} viewBox={`${-MARGIN} ${-MARGIN} ${w} ${h}`} className="block bg-white shadow-lg" data-schedule-paper>
            <rect data-export-ignore-dxf="true" x={-MARGIN} y={-MARGIN} width={w} height={h} fill="#fff" />
            <ScheduleGraphic layout={layout} />
          </svg>
        )}
      </div>
    </div>
  );
}
