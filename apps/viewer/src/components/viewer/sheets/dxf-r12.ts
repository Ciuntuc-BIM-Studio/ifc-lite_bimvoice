/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A minimal DXF R12 (AC1009) writer for sheet export: layers with an ACI
 * colour, LINE, POLYLINE and TEXT, per-entity colour when it differs from
 * the layer's. Kept in the viewer: `@ifc-lite/drawing-2d` keeps its own
 * writer package-private on purpose. Text goes out as windows-1252 (the
 * package's public `encodeDxfCp1252`), declared in the header.
 */

import { encodeDxfCp1252 } from '@ifc-lite/drawing-2d';

type P = { x: number; y: number };

/** The ACI palette's first colours (1–9), enough to keep a drawing's pens apart. */
const ACI: [number, [number, number, number]][] = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]],
  [6, [255, 0, 255]], [7, [0, 0, 0]], [8, [128, 128, 128]], [9, [192, 192, 192]],
];

function rgb(css: string): [number, number, number] {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (h) {
    const n = parseInt(h[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  return [0, 0, 0];
}

/** The nearest ACI colour; black and white both map to 7 (drawn as "foreground"). */
export function aciOf(css: string): number {
  const c = rgb(css);
  let best = 7, bestD = Infinity;
  for (const [index, [r, g, b]] of ACI) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) { best = index; bestD = d; }
  }
  return best;
}

const fmt = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(4)).toString() : '0');
const name = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_$-]/g, '_').slice(0, 31) || '0';

export class DxfR12 {
  private readonly layers = new Map<string, number>();
  private readonly out: string[] = [];

  /** Register (once) and return a layer name; its colour is the first one seen. */
  layer(raw: string, css: string): string {
    const n = name(raw);
    if (!this.layers.has(n)) this.layers.set(n, aciOf(css));
    return n;
  }

  private colour(layer: string, css: string | undefined): string[] {
    if (!css) return [];
    const aci = aciOf(css);
    return aci === this.layers.get(layer) ? [] : ['62', String(aci)];
  }

  line(a: P, b: P, layer: string, css?: string): void {
    this.out.push('0', 'LINE', '8', layer, ...this.colour(layer, css), '10', fmt(a.x), '20', fmt(a.y), '30', '0', '11', fmt(b.x), '21', fmt(b.y), '31', '0');
  }

  polyline(pts: readonly P[], layer: string, css?: string): void {
    if (pts.length < 2) return;
    this.out.push('0', 'POLYLINE', '8', layer, ...this.colour(layer, css), '66', '1', '70', '0');
    for (const p of pts) this.out.push('0', 'VERTEX', '8', layer, '10', fmt(p.x), '20', fmt(p.y), '30', '0');
    this.out.push('0', 'SEQEND', '8', layer);
  }

  text(at: P, value: string, height: number, layer: string, options: { rotationDeg?: number; align?: 'left' | 'center' | 'right'; css?: string } = {}): void {
    const clean = value.replace(/[\r\n]+/g, ' ').trim();
    if (!clean || !(height > 0)) return;
    const h = options.align === 'center' ? 1 : options.align === 'right' ? 2 : 0;
    this.out.push('0', 'TEXT', '8', layer, ...this.colour(layer, options.css), '10', fmt(at.x), '20', fmt(at.y), '30', '0', '40', fmt(height), '1', clean, '50', fmt(options.rotationDeg ?? 0));
    if (h) this.out.push('72', String(h), '11', fmt(at.x), '21', fmt(at.y), '31', '0');
  }

  /** The document, windows-1252 encoded. */
  bytes(comment: string): Uint8Array {
    const head = ['999', comment, '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$DWGCODEPAGE', '3', 'ANSI_1252', '0', 'ENDSEC'];
    const layers = [...this.layers].flatMap(([n, aci]) => ['0', 'LAYER', '2', n, '70', '0', '62', String(aci), '6', 'CONTINUOUS']);
    const tables = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size), ...layers, '0', 'ENDTAB', '0', 'ENDSEC'];
    const entities = ['0', 'SECTION', '2', 'ENTITIES', ...this.out, '0', 'ENDSEC', '0', 'EOF'];
    return encodeDxfCp1252(`${[...head, ...tables, ...entities].join('\n')}\n`).bytes;
  }
}
