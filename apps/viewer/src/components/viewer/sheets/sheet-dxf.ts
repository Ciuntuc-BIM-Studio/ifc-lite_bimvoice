/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A sheet (or any drawn SVG) as DXF R2000 (`dxf-r2000.ts`), exactly as it
 * is drawn: the live SVG is walked, every stroked path, line, rect, circle
 * and text taken to DXF units (Y up) through its own transform. Straight
 * path pieces are read as they are; arcs and curves are sampled by the
 * browser (`getPointAtLength`). Whatever a viewport clips is clipped here
 * too (DXF has no clipping). Each element goes on the layer its nearest
 * tagged ancestor names (`dxf-tags.ts`): drafted lines and annotations on
 * their drafting layer — with its colour, line weight and line type — the
 * generated drawing on CUT / SEEN / HIDDEN / HATCH / SYMBOLS with its pens,
 * the sheet on FRAME / TITLEBLOCK / VIEWPORT-LABELS. Fills are left out.
 */

import { DxfR2000, type PenSpec } from './dxf-r2000';
import type { LineType } from '@/drafting/styles';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import { paperOf } from '@/project/sheets';
import type { ProjectSheet } from '@/project/types';

type P = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };

const SAMPLE_MM = 0.5;
const STRAIGHT = /^[MLHVZmlhvz0-9eE.,\s+-]*$/;

function layerOf(el: Element): string {
  return el.closest('[data-dxf-layer]')?.getAttribute('data-dxf-layer') ?? 'SHEET';
}

const tag = (el: Element, name: string) => el.closest(`[data-dxf-${name}]`)?.getAttribute(`data-dxf-${name}`) ?? undefined;
const LINE_TYPES = new Set<LineType>(['continuous', 'dashed', 'dotted', 'dashdot']);

/** The pen of the layer an element is on (from its tags), and the element's own colour. */
function pensOf(el: Element, colour: string): { layer: PenSpec; own: PenSpec } {
  const lt = tag(el, 'ltype');
  const lineType = LINE_TYPES.has(lt as LineType) ? (lt as LineType) : 'continuous';
  const lw = Number(tag(el, 'lw'));
  const lineWeight = Number.isFinite(lw) && lw > 0 ? lw : 0.25;
  return { layer: { color: tag(el, 'color') ?? colour, lineType, lineWeight }, own: { color: colour, lineType, lineWeight } };
}

function strokeOf(el: Element): string | null {
  const stroke = getComputedStyle(el).stroke;
  return !stroke || stroke === 'none' || stroke === 'transparent' || /rgba\(.*,\s*0\)$/.test(stroke) ? null : stroke;
}

/** Subpaths of a straight-only path `d` (absolute and relative M/L/H/V/Z), local units. */
function straightSubpaths(d: string): { pts: P[]; closed: boolean }[] {
  const out: { pts: P[]; closed: boolean }[] = [];
  const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let cmd = 'M', cur: P = { x: 0, y: 0 }, start: P = cur, path: { pts: P[]; closed: boolean } | null = null;
  for (let i = 0; i < tokens.length;) {
    const tok = tokens[i];
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (path) path.closed = true;
        cur = start;
        path = null;
      }
      continue;
    }
    const num = (k: number) => Number(tokens[i + k]);
    const moved = cmd === 'M' || cmd === 'm';
    switch (cmd) {
      case 'M': case 'm':
        cur = cmd === 'm' ? { x: cur.x + num(0), y: cur.y + num(1) } : { x: num(0), y: num(1) };
        start = cur;
        path = { pts: [cur], closed: false };
        out.push(path);
        cmd = cmd === 'm' ? 'l' : 'L';
        i += 2;
        break;
      case 'L': case 'l':
        cur = cmd === 'l' ? { x: cur.x + num(0), y: cur.y + num(1) } : { x: num(0), y: num(1) };
        i += 2;
        break;
      case 'H': case 'h':
        cur = { x: cmd === 'h' ? cur.x + num(0) : num(0), y: cur.y };
        i += 1;
        break;
      default:
        cur = { x: cur.x, y: cmd === 'v' ? cur.y + num(0) : num(0) };
        i += 1;
    }
    if (!moved) {
      if (!path) {
        path = { pts: [start], closed: false };
        out.push(path);
      }
      path.pts.push(cur);
    }
  }
  return out;
}

/** Any path `d` as sampled subpaths: each `M…` run measured on a scratch path beside `el`. */
function sampledSubpaths(el: SVGGraphicsElement, d: string): { pts: P[]; closed: boolean }[] {
  const out: { pts: P[]; closed: boolean }[] = [];
  const scratch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  el.parentNode?.insertBefore(scratch, el);
  try {
    for (const sub of d.split(/(?=[Mm])/).filter((s) => s.trim())) {
      scratch.setAttribute('d', sub);
      const length = scratch.getTotalLength();
      const n = Math.max(2, Math.ceil(length / SAMPLE_MM));
      const pts = Array.from({ length: n + 1 }, (_, i) => {
        const q = scratch.getPointAtLength((length * i) / n);
        return { x: q.x, y: q.y };
      });
      out.push({ pts, closed: /[Zz]\s*$/.test(sub) });
    }
  } finally {
    scratch.remove();
  }
  return out;
}

/** Cut a polyline to `clip`, segment by segment (Liang–Barsky); the pieces that stay. */
function clipPolyline(pts: P[], clip: Rect | null): P[][] {
  if (!clip) return [pts];
  const pieces: P[][] = [];
  let current: P[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    const edges: [number, number][] = [[-dx, a.x - clip.x0], [dx, clip.x1 - a.x], [-dy, a.y - clip.y0], [dy, clip.y1 - a.y]];
    let inside = true;
    for (const [p, q] of edges) {
      if (Math.abs(p) < 1e-12) { if (q < 0) { inside = false; break; } continue; }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      if (t0 > t1) { inside = false; break; }
    }
    if (!inside) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    const s = { x: a.x + dx * t0, y: a.y + dy * t0 }, e = { x: a.x + dx * t1, y: a.y + dy * t1 };
    if (current.length === 0 || t0 > 0) {
      if (current.length > 1) pieces.push(current);
      current = [s];
    }
    current.push(e);
    if (t1 < 1) {
      pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

export function sheetDxf(svg: SVGSVGElement, sheet: ProjectSheet): Uint8Array {
  return svgToDxf(svg, paperOf(sheet).h, `units: millimetres (paper), sheet ${sheet.number} ${sheet.name}`);
}

/**
 * Any drawn SVG as DXF: its user units become DXF units, y flipped about
 * `h` (y_dxf = h − y_svg) so the drawing reads the same way up.
 */
export function svgToDxf(svg: SVGSVGElement, h: number, comment: string, patternScale = 1): Uint8Array {
  const root = svg.getScreenCTM()?.inverse();
  const writer = new DxfR2000(patternScale);
  if (!root) return writer.bytes(comment);
  // Element-local → paper millimetres, Y up.
  const mapper = (el: SVGGraphicsElement) => {
    const m = root.multiply(el.getScreenCTM() ?? new DOMMatrix());
    return (p: P): P => {
      const q = new DOMPoint(p.x, p.y).matrixTransform(m);
      return { x: q.x, y: h - q.y };
    };
  };
  // The viewport frame an element is clipped to, in paper millimetres (Y up).
  const clipOf = (el: Element): Rect | null => {
    const holder = el.closest('[clip-path]');
    const id = holder?.getAttribute('clip-path')?.match(/url\(#(.+)\)/)?.[1];
    const rect = id ? svg.querySelector(`clipPath[id="${CSS.escape(id)}"] rect`) as SVGRectElement | null : null;
    if (!rect) return null;
    const x = rect.x.baseVal.value, y = rect.y.baseVal.value, w = rect.width.baseVal.value, hh = rect.height.baseVal.value;
    return { x0: x, x1: x + w, y0: h - (y + hh), y1: h - y };
  };
  const skip = (el: Element) => !!el.closest('[data-export-ignore="true"], [data-export-ignore-dxf="true"], clipPath, defs');

  const emit = (el: SVGGraphicsElement, subpaths: { pts: P[]; closed: boolean }[]) => {
    const stroke = strokeOf(el);
    if (!stroke) return;
    const map = mapper(el);
    const pens = pensOf(el, stroke);
    const layer = writer.layer(layerOf(el), pens.layer);
    const clip = clipOf(el);
    const inside = (p: P) => !clip || (p.x >= clip.x0 && p.x <= clip.x1 && p.y >= clip.y0 && p.y <= clip.y1);
    for (const sub of subpaths) {
      const pts = sub.pts.map(map);
      // A closed outline nothing clips stays one closed polyline.
      if (sub.closed && pts.length > 2 && pts.every(inside)) {
        writer.polyline(pts, layer, pens.own, true);
        continue;
      }
      if (sub.closed && pts.length > 2) pts.push(pts[0]);
      for (const piece of clipPolyline(pts, clip)) {
        if (piece.length === 2) writer.line(piece[0], piece[1], layer, pens.own);
        else if (piece.length > 2) writer.polyline(piece, layer, pens.own);
      }
    }
  };

  for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>('path, line, rect, circle, ellipse, polyline, polygon, text'))) {
    if (skip(el)) continue;
    if (el instanceof SVGTextElement) {
      const text = el.textContent?.trim();
      if (!text) continue;
      const map = mapper(el);
      const size = parseFloat(getComputedStyle(el).fontSize) || 2.5;
      const m = root.multiply(el.getScreenCTM() ?? new DOMMatrix());
      const scale = Math.hypot(m.a, m.b);
      const at = map({ x: el.x.baseVal[0]?.value ?? 0, y: el.y.baseVal[0]?.value ?? 0 });
      const anchor = getComputedStyle(el).textAnchor;
      const fill = getComputedStyle(el).fill || '#000';
      const pens = pensOf(el, fill);
      writer.text(at, text, size * scale * 0.72, writer.layer(layerOf(el), pens.layer), {
        rotationDeg: (-Math.atan2(m.b, m.a) * 180) / Math.PI,
        align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
        pen: pens.own,
      });
      continue;
    }
    if (el instanceof SVGLineElement) {
      emit(el, [{ pts: [{ x: el.x1.baseVal.value, y: el.y1.baseVal.value }, { x: el.x2.baseVal.value, y: el.y2.baseVal.value }], closed: false }]);
      continue;
    }
    if (el instanceof SVGRectElement) {
      const x = el.x.baseVal.value, y = el.y.baseVal.value, w = el.width.baseVal.value, hh = el.height.baseVal.value;
      emit(el, [{ pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + hh }, { x, y: y + hh }], closed: true }]);
      continue;
    }
    const d = el instanceof SVGPathElement ? el.getAttribute('d') ?? '' : '';
    if (el instanceof SVGPathElement && STRAIGHT.test(d)) emit(el, straightSubpaths(d));
    else if (el instanceof SVGPathElement) emit(el, sampledSubpaths(el, d));
    else if (el instanceof SVGGeometryElement) {
      // circle, ellipse, polyline, polygon: sampled along their outline.
      const length = el.getTotalLength();
      const n = Math.max(8, Math.ceil(length / SAMPLE_MM));
      const pts = Array.from({ length: n }, (_, i) => {
        const q = el.getPointAtLength((length * i) / n);
        return { x: q.x, y: q.y };
      });
      emit(el, [{ pts, closed: !(el instanceof SVGPolylineElement) }]);
    }
  }
  return writer.bytes(comment);
}

export function exportSheetDxf(svg: SVGSVGElement, sheet: ProjectSheet): void {
  const name = sanitizeFilename(`${sheet.number} ${sheet.name}`, { fallback: 'sheet' });
  downloadFile(sheetDxf(svg, sheet), `${name}.dxf`, 'application/dxf');
}
