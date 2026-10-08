/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The 3D body of a joinery type as axis-aligned boxes in the type frame
 * (`joinery-spec.ts`): the outer frame (a door's threshold instead of a
 * bottom member), mullions and transoms that stop at panels spanning across
 * them, per panel a sash with its glass or a door leaf, a handle on the side
 * opposite the hinges, and the window boards. Every box becomes one
 * IfcExtrudedAreaSolid of the type's representation map.
 */

import { gridExtents, innerRect, isDoorLeaf, normalisedPanels, panelRect, type CellRect, type JoineryPanel, type JoinerySpec, type PanelOperation } from './joinery-spec.js';

export type JoineryRole = 'frame' | 'sash' | 'glass' | 'leaf' | 'board' | 'handle';

export interface JoineryBox {
  role: JoineryRole;
  min: [number, number, number];
  max: [number, number, number];
}

const HANDLE = { width: 0.03, depth: 0.05, height: 0.14, inset: 0.03 };

/** Which side the handle goes: opposite the hinges; null for panels without one. */
export function handleSide(op: PanelOperation): 'left' | 'right' | 'top' | 'bottom' | null {
  if (op.endsWith('-left')) return 'right';
  if (op.endsWith('-right')) return 'left';
  if (op === 'bottom-hung') return 'top';
  if (op === 'top-hung') return 'bottom';
  return null;
}

/** Bars between the cells, interrupted where a panel spans across them. */
function bars(spec: JoinerySpec, panels: readonly JoineryPanel[], y0: number, y1: number): JoineryBox[] {
  const { cols, rows } = gridExtents(spec);
  const spansCol = (boundary: number, row: number) => panels.some((p) =>
    p.col <= boundary && p.col + (p.colSpan ?? 1) - 1 > boundary && p.row <= row && p.row + (p.rowSpan ?? 1) - 1 >= row);
  const spansRow = (boundary: number, col: number) => panels.some((p) =>
    p.row <= boundary && p.row + (p.rowSpan ?? 1) - 1 > boundary && p.col <= col && p.col + (p.colSpan ?? 1) - 1 >= col);
  const out: JoineryBox[] = [];
  const box = (x0: number, x1: number, z0: number, z1: number) => out.push({ role: 'frame', min: [x0, y0, z0], max: [x1, y1, z1] });
  for (let i = 0; i < cols.length - 1; i++) {
    const x0 = cols[i][1], x1 = cols[i + 1][0];
    rows.forEach(([z0, z1], r) => { if (!spansCol(i, r)) box(x0, x1, z0, z1); });
  }
  for (let j = 0; j < rows.length - 1; j++) {
    const z0 = rows[j][1], z1 = rows[j + 1][0];
    cols.forEach(([x0, x1], c) => { if (!spansRow(j, c)) box(x0, x1, z0, z1); });
  }
  // Crossings: where any bar meets the square between four cells.
  for (let i = 0; i < cols.length - 1; i++) {
    for (let j = 0; j < rows.length - 1; j++) {
      const meets = !spansCol(i, j) || !spansCol(i, j + 1) || !spansRow(j, i) || !spansRow(j, i + 1);
      if (meets) box(cols[i][1], cols[i + 1][0], rows[j][1], rows[j + 1][0]);
    }
  }
  return out;
}

/** Four members of width `w` around `r`, the vertical ones full height. */
function ring(r: CellRect, w: number, y0: number, y1: number, role: JoineryRole): JoineryBox[] {
  return [
    { role, min: [r.x0, y0, r.z0], max: [r.x0 + w, y1, r.z1] },
    { role, min: [r.x1 - w, y0, r.z0], max: [r.x1, y1, r.z1] },
    { role, min: [r.x0 + w, y0, r.z0], max: [r.x1 - w, y1, r.z0 + w] },
    { role, min: [r.x0 + w, y0, r.z1 - w], max: [r.x1 - w, y1, r.z1] },
  ];
}

function glass(r: CellRect, inset: number, y: number, t: number): JoineryBox {
  return { role: 'glass', min: [r.x0 + inset, y - t / 2, r.z0 + inset], max: [r.x1 - inset, y + t / 2, r.z1 - inset] };
}

function handle(r: CellRect, op: PanelOperation, interiorFace: number, kind: 'door' | 'window'): JoineryBox | null {
  const side = handleSide(op);
  if (!side) return null;
  const y1 = interiorFace, y0 = interiorFace - HANDLE.depth;
  const w = HANDLE.width, h = HANDLE.height, inset = HANDLE.inset + w / 2;
  if (side === 'left' || side === 'right') {
    const x = side === 'left' ? r.x0 + inset : r.x1 - inset;
    const zc = kind === 'door' ? Math.min(r.z0 + 1.05, (r.z0 + r.z1) / 2 + 0.3) : (r.z0 + r.z1) / 2;
    return { role: 'handle', min: [x - w / 2, y0, zc - h / 2], max: [x + w / 2, y1, zc + h / 2] };
  }
  const z = side === 'top' ? r.z1 - inset : r.z0 + inset;
  const xc = (r.x0 + r.x1) / 2;
  return { role: 'handle', min: [xc - h / 2, y0, z - w / 2], max: [xc + h / 2, y1, z + w / 2] };
}

export function joineryBoxes(spec: JoinerySpec): JoineryBox[] {
  const f = spec.frame;
  const y0 = f.offset - f.depth / 2, y1 = f.offset + f.depth / 2;
  const outer: CellRect = { x0: -spec.width / 2, x1: spec.width / 2, z0: 0, z1: spec.height };
  const inner = innerRect(spec);
  const boxes: JoineryBox[] = [
    { role: 'frame', min: [outer.x0, y0, 0], max: [inner.x0, y1, spec.height] },
    { role: 'frame', min: [inner.x1, y0, 0], max: [outer.x1, y1, spec.height] },
    { role: 'frame', min: [inner.x0, y0, inner.z1], max: [inner.x1, y1, spec.height] },
  ];
  if (inner.z0 > 1e-6) boxes.push({ role: 'frame', min: [inner.x0, y0, 0], max: [inner.x1, y1, inner.z0] });
  const panels = normalisedPanels(spec);
  boxes.push(...bars(spec, panels, y0, y1));

  const s = spec.sash;
  for (const p of panels) {
    const r = panelRect(spec, p);
    const sy0 = f.offset - s.depth / 2, sy1 = f.offset + s.depth / 2;
    if (isDoorLeaf(p.operation)) {
      const t = s.leafThickness;
      const ly0 = f.offset - t / 2, ly1 = f.offset + t / 2;
      if (p.glazed) {
        boxes.push(...ring(r, s.width, ly0, ly1, 'leaf'), glass(r, s.width, f.offset, s.glassThickness));
      } else {
        boxes.push({ role: 'leaf', min: [r.x0, ly0, r.z0], max: [r.x1, ly1, r.z1] });
      }
      const h = handle(r, p.operation, ly0, 'door');
      if (h) boxes.push(h);
    } else if (p.operation === 'fixed') {
      boxes.push(glass(r, 0, f.offset, s.glassThickness));
    } else {
      boxes.push(...ring(r, s.width, sy0, sy1, 'sash'), glass(r, s.width, f.offset, s.glassThickness));
      const h = handle(r, p.operation, sy0, 'window');
      if (h) boxes.push(h);
    }
  }

  if (spec.kind === 'window') {
    const t = 0.025;
    if (spec.board.interior > 0) boxes.push({ role: 'board', min: [outer.x0, y0 - spec.board.interior, 0], max: [outer.x1, y0, t] });
    if (spec.board.exterior > 0) boxes.push({ role: 'board', min: [outer.x0, y1, 0], max: [outer.x1, y1 + spec.board.exterior, t] });
  }
  return boxes.filter((b) => b.max.every((v, i) => v - b.min[i] > 1e-6));
}
