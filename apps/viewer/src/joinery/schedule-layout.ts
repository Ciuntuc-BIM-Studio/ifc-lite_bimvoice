/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A joinery schedule laid out on paper (millimetres, y down), as the list a
 * drawing set carries: one card per type — its mark, its elevation seen from
 * the interior with the opening symbols and the hardware scheme (hinges,
 * handles) at the schedule's scale, dimensioned — over the rows of data:
 * name, size, operation, sill, count per level, total, U value, fire rating.
 * A label column runs down the left; cards wrap into bands under a maximum
 * width. Pure: the screen tab, sheets, SVG and DXF all draw these primitives.
 */

import { normalisedPanels, type PanelOperation } from '@ifc-lite/create';
import { elevationSymbol, strokeBounds } from './symbols';
import type { ScheduleData, ScheduleEntry } from './schedule-data';

export type SchedulePrim =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { kind: 'path'; pts: { x: number; y: number }[]; closed?: boolean; w: number; dashed?: boolean }
  | { kind: 'text'; x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; bold?: boolean; rotate?: number };

export interface ScheduleLayout {
  width: number;
  height: number;
  prims: SchedulePrim[];
}

export interface ScheduleLabels {
  title: string;
  mark: string;
  name: string;
  size: string;
  operation: string;
  sill: string;
  total: string;
  uValue: string;
  fire: string;
  /** A panel operation's short name. */
  op: (op: PanelOperation) => string;
}

export interface ScheduleLayoutOptions {
  /** Scale of the drawings: 50 = 1:50. */
  scale?: number;
  /** Cards wrap past this width (mm). */
  maxWidth?: number;
}

const LABEL_W = 34;
const ROW = 6;
const MARK_ROW = 10;
const PEN = { frame: 0.35, grid: 0.18, drawing: { cut: 0.35, outline: 0.25, thin: 0.13 } } as const;
const TEXT = 2.5;

export function operationText(entry: ScheduleEntry, labels: ScheduleLabels): string {
  if (!entry.spec) return '—';
  const ops = [...new Set(normalisedPanels(entry.spec).map((p) => p.operation))];
  return ops.map(labels.op).join(' + ');
}

function rows(data: ScheduleData, labels: ScheduleLabels): { label: string; value: (e: ScheduleEntry) => string; strong?: boolean }[] {
  const out: { label: string; value: (e: ScheduleEntry) => string; strong?: boolean }[] = [
    { label: labels.name, value: (e) => e.name },
    { label: labels.size, value: (e) => `${Math.round(e.width * 1000)} × ${Math.round(e.height * 1000)}` },
    { label: labels.operation, value: (e) => operationText(e, labels) },
  ];
  if (data.entries.some((e) => e.kind === 'window')) out.push({ label: labels.sill, value: (e) => (e.kind === 'window' && e.spec ? String(Math.round(e.spec.sillHeight * 1000)) : '—') });
  for (const level of data.levels) out.push({ label: level, value: (e) => String(e.counts[level] ?? '') });
  out.push({ label: labels.total, value: (e) => String(e.total), strong: true });
  out.push({ label: labels.uValue, value: (e) => (e.spec?.props.thermalTransmittance !== undefined ? String(e.spec.props.thermalTransmittance) : '—') });
  out.push({ label: labels.fire, value: (e) => e.spec?.props.fireRating ?? '—' });
  return out;
}

/** A dimension line between `a` and `b` (paper mm), its value written above (or left of) the line. */
function dimension(prims: SchedulePrim[], a: { x: number; y: number }, b: { x: number; y: number }, text: string): void {
  prims.push({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: PEN.grid });
  for (const p of [a, b]) prims.push({ kind: 'line', x1: p.x - 0.8, y1: p.y + 0.8, x2: p.x + 0.8, y2: p.y - 0.8, w: PEN.drawing.outline });
  const vertical = Math.abs(a.x - b.x) < 1e-6;
  if (vertical) prims.push({ kind: 'text', x: a.x - 1, y: (a.y + b.y) / 2, text, size: 2, anchor: 'middle', rotate: -90 });
  else prims.push({ kind: 'text', x: (a.x + b.x) / 2, y: a.y - 0.8, text, size: 2, anchor: 'middle' });
}

export function layoutSchedule(data: ScheduleData, labels: ScheduleLabels, options: ScheduleLayoutOptions = {}): ScheduleLayout {
  const k = 1000 / (options.scale ?? 50);
  const maxWidth = options.maxWidth ?? 380;
  const prims: SchedulePrim[] = [];
  const tableRows = rows(data, labels);
  const cardW = (e: ScheduleEntry) => Math.max(30, e.width * k + 16);
  const drawingH = Math.max(30, ...data.entries.map((e) => e.height * k + 14));
  const bandH = MARK_ROW + drawingH + tableRows.length * ROW;

  // Split the cards into bands.
  const bands: ScheduleEntry[][] = [];
  let band: ScheduleEntry[] = [], used = LABEL_W;
  for (const e of data.entries) {
    if (band.length && used + cardW(e) > maxWidth) { bands.push(band); band = []; used = LABEL_W; }
    band.push(e);
    used += cardW(e);
  }
  if (band.length || bands.length === 0) bands.push(band);

  prims.push({ kind: 'text', x: 0, y: 6, text: labels.title, size: 5, anchor: 'start', bold: true });
  let top = 10, width = LABEL_W;
  for (const cards of bands) {
    const w = LABEL_W + cards.reduce((s, e) => s + cardW(e), 0);
    width = Math.max(width, w);
    const yRows = top + MARK_ROW + drawingH;
    // Frame, label column, row lines.
    prims.push({ kind: 'path', pts: [{ x: 0, y: top }, { x: w, y: top }, { x: w, y: top + bandH }, { x: 0, y: top + bandH }], closed: true, w: PEN.frame });
    prims.push({ kind: 'line', x1: LABEL_W, y1: top, x2: LABEL_W, y2: top + bandH, w: PEN.frame });
    prims.push({ kind: 'line', x1: 0, y1: top + MARK_ROW, x2: w, y2: top + MARK_ROW, w: PEN.grid });
    prims.push({ kind: 'text', x: 2, y: top + 6.5, text: labels.mark, size: TEXT, anchor: 'start', bold: true });
    tableRows.forEach((row, i) => {
      const y = yRows + i * ROW;
      prims.push({ kind: 'line', x1: 0, y1: y, x2: w, y2: y, w: i === 0 ? PEN.frame : PEN.grid });
      prims.push({ kind: 'text', x: 2, y: y + 4.2, text: row.label, size: TEXT, anchor: 'start', bold: row.strong });
    });
    let x = LABEL_W;
    for (const e of cards) {
      const cw = cardW(e);
      const cx = x + cw / 2;
      prims.push({ kind: 'line', x1: x + cw, y1: top, x2: x + cw, y2: top + bandH, w: PEN.grid });
      prims.push({ kind: 'text', x: cx, y: top + 7, text: e.mark, size: 4, anchor: 'middle', bold: true });
      // The elevation, bottom on a baseline that leaves room for the width dimension.
      const base = top + MARK_ROW + drawingH - 7;
      const x0 = cx - (e.width * k) / 2, x1 = cx + (e.width * k) / 2;
      if (e.spec) {
        const strokes = elevationSymbol(e.spec, { hardware: true });
        const b = strokeBounds(strokes);
        const ox = cx - ((b.min.x + b.max.x) / 2) * k;
        for (const s of strokes) {
          prims.push({ kind: 'path', pts: s.pts.map((p) => ({ x: ox + p.x * k, y: base - p.y * k })), closed: s.closed, w: PEN.drawing[s.weight], dashed: s.dashed });
        }
      } else {
        prims.push({ kind: 'path', pts: [{ x: x0, y: base }, { x: x1, y: base }, { x: x1, y: base - e.height * k }, { x: x0, y: base - e.height * k }], closed: true, w: PEN.drawing.outline });
      }
      dimension(prims, { x: x0, y: base + 4.5 }, { x: x1, y: base + 4.5 }, String(Math.round(e.width * 1000)));
      dimension(prims, { x: x0 - 4, y: base }, { x: x0 - 4, y: base - e.height * k }, String(Math.round(e.height * 1000)));
      tableRows.forEach((row, i) => {
        const value = row.value(e);
        const size = value.length > cw / 1.6 ? Math.max(1.6, (cw - 2) / value.length * 1.7) : TEXT;
        prims.push({ kind: 'text', x: cx, y: yRows + i * ROW + 4.2, text: value, size, anchor: 'middle', bold: row.strong });
      });
      x += cw;
    }
    top += bandH + 8;
  }
  return { width, height: top - 8, prims };
}

/** The schedule as CSV (one line per type), the counts per level as columns. */
export function scheduleCsv(data: ScheduleData, labels: ScheduleLabels): string {
  const quote = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = [labels.mark, labels.name, 'Width (mm)', 'Height (mm)', labels.operation, labels.sill, ...data.levels, labels.total, labels.uValue, labels.fire];
  const lines = data.entries.map((e) => [
    e.mark, e.name, String(Math.round(e.width * 1000)), String(Math.round(e.height * 1000)), operationText(e, labels),
    e.kind === 'window' && e.spec ? String(Math.round(e.spec.sillHeight * 1000)) : '',
    ...data.levels.map((l) => String(e.counts[l] ?? 0)), String(e.total),
    e.spec?.props.thermalTransmittance !== undefined ? String(e.spec.props.thermalTransmittance) : '', e.spec?.props.fireRating ?? '',
  ]);
  return [header, ...lines].map((r) => r.map(quote).join(',')).join('\n') + '\n';
}
