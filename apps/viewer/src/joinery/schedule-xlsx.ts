/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A joinery schedule as an Excel workbook: the Types sheet (the same
 * columns as the CSV, counts per level as numbers) and the Elements sheet —
 * every door and window with its number within its type (`occurrenceMark`),
 * its level and its GlobalId, so a site list and the model agree.
 */

import { neutralizeSpreadsheetFormula } from '@/lib/lists/export/model';
import { operationText, type ScheduleLabels } from './schedule-layout';
import { occurrenceMark, type ScheduleData } from './schedule-data';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Cell = string | number | null;
const text = (v: string) => neutralizeSpreadsheetFormula(v);

export interface ScheduleXlsxLabels extends ScheduleLabels {
  types: string;
  elements: string;
  number: string;
  level: string;
  globalId: string;
}

export async function scheduleXlsx(data: ScheduleData, labels: ScheduleXlsxLabels): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IFC-Lite';

  const sheet = (name: string, header: string[], rows: Cell[][], numeric: number[]) => {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.addRow([text(labels.title)]);
    ws.mergeCells(1, 1, 1, header.length);
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    const h = ws.addRow(header.map(text));
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; });
    header.forEach((label, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(10, Math.min(40, label.length + 4));
      if (numeric.includes(i)) col.alignment = { horizontal: 'right' };
    });
    for (const r of rows) ws.addRow(r.map((v) => (typeof v === 'string' ? text(v) : v)));
    return ws;
  };

  const mm = (m: number) => Math.round(m * 1000);
  const header = [labels.mark, labels.name, 'Width (mm)', 'Height (mm)', labels.operation, labels.sill, ...data.levels, labels.total, labels.uValue, labels.fire];
  const types = sheet(labels.types, header, data.entries.map((e) => [
    e.mark, e.name, mm(e.width), mm(e.height), operationText(e, labels),
    e.kind === 'window' && e.spec ? mm(e.spec.sillHeight) : null,
    ...data.levels.map((l) => e.counts[l] ?? 0), e.total,
    e.spec?.props.thermalTransmittance ?? null, e.spec?.props.fireRating ?? null,
  ]), [2, 3, 5, ...data.levels.map((_, i) => 6 + i), 6 + data.levels.length, 7 + data.levels.length]);
  const total = types.addRow([labels.total, null, null, null, null, null, ...data.levels.map((l) => data.entries.reduce((s, e) => s + (e.counts[l] ?? 0), 0)), data.entries.reduce((s, e) => s + e.total, 0)]);
  total.font = { bold: true };

  sheet(labels.elements, [labels.number, labels.mark, labels.name, 'Width (mm)', 'Height (mm)', labels.level, labels.globalId],
    data.entries.flatMap((e) => e.occurrences.map((o) => [occurrenceMark(e, o), e.mark, e.name, mm(e.width), mm(e.height), o.level, o.globalId])), [3, 4]);

  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_MIME });
}
