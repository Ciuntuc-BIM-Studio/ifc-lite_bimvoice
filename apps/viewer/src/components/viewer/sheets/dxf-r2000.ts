/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DXF R2000 (AC1015) for drawing exports — what CAD layers need: every
 * layer with its colour (ACI and true colour), line type and line weight,
 * entities BYLAYER unless they differ from their layer.
 *
 * A complete minimal R2000 document (tables, blocks, layouts, dictionaries —
 * what strict readers expect) is kept as a skeleton file; this writer adds
 * line types to its LTYPE table, layers to its LAYER table and entities to
 * ENTITIES, with handles above the skeleton's, and sets $HANDSEED. Text is
 * written as windows-1252 (`encodeDxfCp1252`), declared in the header.
 */

import { encodeDxfCp1252 } from '@ifc-lite/drawing-2d';
import { dashOf, type LineType } from '@/drafting/styles';
import skeleton from './dxf-r2000-skeleton.dxf?raw';

type P = { x: number; y: number };

/** Skeleton handles: the LTYPE and LAYER tables, model space's block record, the plot-style placeholder. */
const LTYPE_TABLE = '2';
const LAYER_TABLE = '1';
const MODEL_SPACE = '17';
const PLOT_STYLE = '13';
const FIRST_HANDLE = 0x100;

/** DXF line weights, 1/100 mm. */
const WEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

/** A pen width in mm as the nearest DXF line weight. */
export function dxfLineWeight(mm: number): number {
  const v = Math.round(mm * 100);
  return WEIGHTS.reduce((best, w) => (Math.abs(w - v) < Math.abs(best - v) ? w : best), 25);
}

const ACI: [number, [number, number, number]][] = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]],
  [6, [255, 0, 255]], [7, [0, 0, 0]], [8, [128, 128, 128]], [9, [192, 192, 192]],
];

export function rgbOf(css: string): [number, number, number] {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (h) {
    const n = parseInt(h[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  return [0, 0, 0];
}

/** The nearest ACI colour (black and white both 7, "foreground"). */
export function aciOf(css: string): number {
  const c = rgbOf(css);
  let best = 7, bestD = Infinity;
  for (const [index, [r, g, b]] of ACI) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) { best = index; bestD = d; }
  }
  return best;
}

const trueColor = (css: string) => {
  const [r, g, b] = rgbOf(css);
  return (r << 16) | (g << 8) | b;
};

const fmt = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(4)).toString() : '0');
const safeName = (s: string) => s.replace(/[<>/\\":;?*|=`]/g, '_').trim().slice(0, 255) || '0';
const LINE_TYPE_NAME: Record<LineType, string> = { continuous: 'Continuous', dashed: 'DASHED', dotted: 'DOT', dashdot: 'DASHDOT' };

export interface PenSpec {
  color: string;
  lineType?: LineType;
  /** Millimetres. */
  lineWeight?: number;
}

interface Layer { color: string; lineType: LineType; lineWeight: number }

export class DxfR2000 {
  private readonly layers = new Map<string, Layer>();
  private readonly out: string[] = [];
  private handle = FIRST_HANDLE;

  /** `patternScale` multiplies line-type dash lengths (paper mm): the view's scale for a 1:1 model export. */
  constructor(private readonly patternScale = 1) {}

  private next(): string {
    return (this.handle++).toString(16).toUpperCase();
  }

  /** Register a layer (its first pen defines it) and return its DXF name. */
  layer(raw: string, pen: PenSpec): string {
    const name = safeName(raw);
    if (!this.layers.has(name)) this.layers.set(name, { color: pen.color, lineType: pen.lineType ?? 'continuous', lineWeight: dxfLineWeight(pen.lineWeight ?? 0.25) });
    return name;
  }

  /** Group codes for what an entity does not take BYLAYER. */
  private own(layer: string, pen?: PenSpec): string[] {
    const l = this.layers.get(layer);
    if (!pen || !l) return [];
    const out: string[] = [];
    if (aciOf(pen.color) !== aciOf(l.color) || trueColor(pen.color) !== trueColor(l.color)) out.push('62', String(aciOf(pen.color)), '420', String(trueColor(pen.color)));
    if (pen.lineType && pen.lineType !== l.lineType) out.push('6', LINE_TYPE_NAME[pen.lineType]);
    if (pen.lineWeight !== undefined && dxfLineWeight(pen.lineWeight) !== l.lineWeight) out.push('370', String(dxfLineWeight(pen.lineWeight)));
    return out;
  }

  private head(kind: string, layer: string, pen?: PenSpec): string[] {
    return ['0', kind, '5', this.next(), '330', MODEL_SPACE, '100', 'AcDbEntity', '8', layer, ...this.own(layer, pen)];
  }

  line(a: P, b: P, layer: string, pen?: PenSpec): void {
    this.out.push(...this.head('LINE', layer, pen), '100', 'AcDbLine', '10', fmt(a.x), '20', fmt(a.y), '30', '0', '11', fmt(b.x), '21', fmt(b.y), '31', '0');
  }

  polyline(pts: readonly P[], layer: string, pen?: PenSpec, closed = false): void {
    if (pts.length < 2) return;
    this.out.push(...this.head('LWPOLYLINE', layer, pen), '100', 'AcDbPolyline', '90', String(pts.length), '70', closed ? '1' : '0');
    for (const p of pts) this.out.push('10', fmt(p.x), '20', fmt(p.y));
  }

  text(at: P, value: string, height: number, layer: string, options: { rotationDeg?: number; align?: 'left' | 'center' | 'right'; pen?: PenSpec } = {}): void {
    const clean = value.replace(/[\r\n]+/g, ' ').trim();
    if (!clean || !(height > 0)) return;
    const h = options.align === 'center' ? 1 : options.align === 'right' ? 2 : 0;
    this.out.push(...this.head('TEXT', layer, options.pen), '100', 'AcDbText', '10', fmt(at.x), '20', fmt(at.y), '30', '0', '40', fmt(height), '1', clean,
      '50', fmt(options.rotationDeg ?? 0), '7', 'Standard');
    if (h) this.out.push('72', String(h), '11', fmt(at.x), '21', fmt(at.y), '31', '0');
    this.out.push('100', 'AcDbText');
  }

  private lineTypes(): string[] {
    const out: string[] = [];
    for (const type of ['dashed', 'dotted', 'dashdot'] as const) {
      // Dashes positive, gaps negative, in drawing units.
      const dashes = dashOf(type).map((d, i) => (i % 2 === 0 ? d : -d) * this.patternScale);
      out.push('0', 'LTYPE', '5', this.next(), '330', LTYPE_TABLE, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord',
        '2', LINE_TYPE_NAME[type], '70', '0', '3', type, '72', '65', '73', String(dashes.length), '40', fmt(dashes.reduce((s, d) => s + Math.abs(d), 0)));
      for (const d of dashes) out.push('49', fmt(d), '74', '0');
    }
    return out;
  }

  private layerTable(): string[] {
    const out: string[] = [];
    for (const [name, l] of this.layers) {
      if (name === '0') continue;
      out.push('0', 'LAYER', '5', this.next(), '330', LAYER_TABLE, '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord',
        '2', name, '70', '0', '62', String(aciOf(l.color)), '420', String(trueColor(l.color)), '6', LINE_TYPE_NAME[l.lineType], '370', String(l.lineWeight), '390', PLOT_STYLE);
    }
    return out;
  }

  /** The document, windows-1252 encoded. */
  bytes(comment: string): Uint8Array {
    const ltypes = this.lineTypes();
    const layers = this.layerTable();
    const pairs = (list: string[]) => list.map((v, i) => (i % 2 === 0 ? v.padStart(3) : v)).join('\n');
    const text = skeleton
      .replace(/^999\n[^\n]*\n/, `999\n${comment.replace(/\n/g, ' ')}\n`)
      .replace('{{LTYPES}}\n', ltypes.length ? `${pairs(ltypes)}\n` : '')
      .replace('{{LAYERS}}\n', layers.length ? `${pairs(layers)}\n` : '')
      .replace('{{ENTITIES}}\n', this.out.length ? `${pairs(this.out)}\n` : '')
      .replace('{{HANDSEED}}', this.handle.toString(16).toUpperCase());
    return encodeDxfCp1252(text).bytes;
  }
}
