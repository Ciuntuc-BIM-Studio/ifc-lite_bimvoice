/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A door or window type as a configurator edits it: the overall size (the
 * opening it fills), the frame (lining) and its position across the wall, a
 * grid of columns and rows split by mullions and transoms, and per cell (or
 * span of cells) a panel with its operation — fixed, side-hung, tilt-and-turn,
 * sliding, a door leaf… Everything else (the IFC type, its lining and panel
 * property sets, the 3D body, the 2D symbols, the joinery schedule) is
 * derived from this one record.
 *
 * Frame of reference — the type's local frame, which an occurrence's
 * placement puts in the wall: X along the wall (centred on the opening),
 * Y across the wall (0 on the wall's centre plane, +Y towards the exterior),
 * Z up from the opening's bottom. "Left" and "right" are as seen from the
 * interior, looking out: hinges of a `side-left` panel are on the left.
 * Lengths are metres.
 */

export type JoineryKind = 'door' | 'window';

export type PanelOperation =
  // Windows (and glazed door parts).
  | 'fixed'
  | 'side-left' | 'side-right'
  | 'tilt-turn-left' | 'tilt-turn-right'
  | 'bottom-hung' | 'top-hung'
  | 'pivot-horizontal' | 'pivot-vertical'
  | 'sliding-left' | 'sliding-right' | 'sliding-vertical'
  // Door leaves.
  | 'swing-left' | 'swing-right'
  | 'double-acting-left' | 'double-acting-right'
  | 'door-sliding-left' | 'door-sliding-right'
  | 'folding-left' | 'folding-right';

export const WINDOW_OPERATIONS: readonly PanelOperation[] = [
  'fixed', 'side-left', 'side-right', 'tilt-turn-left', 'tilt-turn-right', 'bottom-hung', 'top-hung',
  'pivot-horizontal', 'pivot-vertical', 'sliding-left', 'sliding-right', 'sliding-vertical',
];
export const DOOR_OPERATIONS: readonly PanelOperation[] = [
  'swing-left', 'swing-right', 'double-acting-left', 'double-acting-right',
  'door-sliding-left', 'door-sliding-right', 'folding-left', 'folding-right',
];

/** A door leaf (opaque, unless `glazed`) rather than a glazed sash. */
export function isDoorLeaf(operation: PanelOperation): boolean {
  return DOOR_OPERATIONS.includes(operation);
}

/** Hinged on a vertical side: the panel swings open in plan. */
export function swingsInPlan(operation: PanelOperation): boolean {
  return ['side-left', 'side-right', 'tilt-turn-left', 'tilt-turn-right', 'swing-left', 'swing-right', 'double-acting-left', 'double-acting-right'].includes(operation);
}

export interface JoineryPanel {
  /** Grid cell of the panel's bottom-left corner (columns left → right, rows bottom → top). */
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  operation: PanelOperation;
  /** A door leaf with glass in it (a window panel is always glazed). */
  glazed?: boolean;
}

export interface JoineryFrame {
  /** Across the wall (IFC LiningDepth). */
  depth: number;
  /** Face width of the outer frame members (IFC LiningThickness). */
  width: number;
  /** Face width of mullions (vertical) and transoms (horizontal) between cells. */
  mullion: number;
  transom: number;
  /** The frame's centre across the wall, from the wall's centre plane, +Y towards the exterior. */
  offset: number;
}

export interface JoinerySash {
  /** Face width of a sash (casement) profile; a door leaf is a solid slab instead. */
  width: number;
  /** Across the wall. */
  depth: number;
  /** Door leaf thickness. */
  leafThickness: number;
  glassThickness: number;
}

export interface JoineryCommonProps {
  isExternal: boolean;
  /** W/(m²K). */
  thermalTransmittance?: number;
  fireRating?: string;
  acousticRating?: string;
  securityRating?: string;
  /** Windows: infiltration / water tightness etc. are left to the user's own psets. */
  reference?: string;
}

export interface JoinerySpec {
  /** The project catalogue entry this type is (one type object per entry per model). */
  id?: string;
  kind: JoineryKind;
  name: string;
  /** Schedule mark prefix: occurrences are tagged `<mark><n>`. */
  mark: string;
  /** Overall width and height: the opening the joinery fills. */
  width: number;
  height: number;
  /** Windows: default sill height above the floor for a new placement. */
  sillHeight: number;
  frame: JoineryFrame;
  sash: JoinerySash;
  /** Column widths and row heights as proportions; normalised to the inside of the frame. */
  columns: number[];
  rows: number[];
  panels: JoineryPanel[];
  /** Window board (interior) and external sill projections; a door's threshold height. */
  board: { interior: number; exterior: number };
  threshold: number;
  colors: { frame: string; glass: string; leaf: string };
  props: JoineryCommonProps;
}

export function defaultWindowSpec(name = 'Window'): JoinerySpec {
  return {
    kind: 'window', name, mark: 'W', width: 1.2, height: 1.5, sillHeight: 0.9,
    frame: { depth: 0.07, width: 0.06, mullion: 0.08, transom: 0.08, offset: 0 },
    sash: { width: 0.07, depth: 0.08, leafThickness: 0.04, glassThickness: 0.024 },
    columns: [1, 1], rows: [1],
    panels: [{ col: 0, row: 0, operation: 'tilt-turn-left' }, { col: 1, row: 0, operation: 'side-right' }],
    board: { interior: 0.2, exterior: 0.05 }, threshold: 0,
    colors: { frame: '#f2f2f2', glass: '#9cc8e8', leaf: '#c8a27a' },
    props: { isExternal: true, thermalTransmittance: 1.1 },
  };
}

export function defaultDoorSpec(name = 'Door'): JoinerySpec {
  return {
    kind: 'door', name, mark: 'D', width: 0.9, height: 2.1, sillHeight: 0,
    frame: { depth: 0.1, width: 0.05, mullion: 0.06, transom: 0.06, offset: 0 },
    sash: { width: 0.1, depth: 0.06, leafThickness: 0.04, glassThickness: 0.024 },
    columns: [1], rows: [1],
    panels: [{ col: 0, row: 0, operation: 'swing-left' }],
    board: { interior: 0, exterior: 0 }, threshold: 0.02,
    colors: { frame: '#e8e8e8', glass: '#9cc8e8', leaf: '#c8a27a' },
    props: { isExternal: false },
  };
}

export interface CellRect {
  /** Inside the frame, in the type frame's X (along) and Z (up). */
  x0: number; x1: number; z0: number; z1: number;
}

/** The clear opening inside the outer frame members (a door has a threshold, not a bottom member). */
export function innerRect(spec: JoinerySpec): CellRect {
  const f = spec.frame.width;
  const bottom = spec.kind === 'door' ? Math.max(0, spec.threshold) : f;
  return { x0: -spec.width / 2 + f, x1: spec.width / 2 - f, z0: bottom, z1: spec.height - f };
}

function splits(weights: readonly number[], from: number, to: number, bar: number): [number, number][] {
  const total = weights.reduce((s, w) => s + Math.max(w, 0), 0) || 1;
  const usable = to - from - bar * (weights.length - 1);
  const out: [number, number][] = [];
  let at = from;
  weights.forEach((w, i) => {
    const size = usable * Math.max(w, 0) / total;
    out.push([at, at + size]);
    at += size + (i < weights.length - 1 ? bar : 0);
  });
  return out;
}

/** Column [x0, x1] and row [z0, z1] extents, mullions and transoms excluded. */
export function gridExtents(spec: JoinerySpec): { cols: [number, number][]; rows: [number, number][] } {
  const r = innerRect(spec);
  return { cols: splits(spec.columns, r.x0, r.x1, spec.frame.mullion), rows: splits(spec.rows, r.z0, r.z1, spec.frame.transom) };
}

/** A panel's rectangle: its cells and the mullions / transoms between them. */
export function panelRect(spec: JoinerySpec, panel: JoineryPanel): CellRect {
  const { cols, rows } = gridExtents(spec);
  const c1 = Math.min(cols.length - 1, panel.col + (panel.colSpan ?? 1) - 1);
  const r1 = Math.min(rows.length - 1, panel.row + (panel.rowSpan ?? 1) - 1);
  return { x0: cols[panel.col][0], x1: cols[c1][1], z0: rows[panel.row][0], z1: rows[r1][1] };
}

/** Every grid cell covered by exactly one panel; cells no panel covers become fixed glazing. */
export function normalisedPanels(spec: JoinerySpec): JoineryPanel[] {
  const nc = spec.columns.length, nr = spec.rows.length;
  const taken: boolean[][] = Array.from({ length: nc }, () => new Array<boolean>(nr).fill(false));
  const out: JoineryPanel[] = [];
  for (const p of spec.panels) {
    if (p.col < 0 || p.row < 0 || p.col >= nc || p.row >= nr) continue;
    const cs = Math.max(1, Math.min(p.colSpan ?? 1, nc - p.col)), rs = Math.max(1, Math.min(p.rowSpan ?? 1, nr - p.row));
    let free = true;
    for (let c = p.col; c < p.col + cs; c++) for (let r = p.row; r < p.row + rs; r++) if (taken[c][r]) free = false;
    if (!free) continue;
    for (let c = p.col; c < p.col + cs; c++) for (let r = p.row; r < p.row + rs; r++) taken[c][r] = true;
    out.push({ ...p, colSpan: cs, rowSpan: rs });
  }
  for (let c = 0; c < nc; c++) for (let r = 0; r < nr; r++) {
    if (!taken[c][r]) out.push({ col: c, row: r, colSpan: 1, rowSpan: 1, operation: 'fixed' });
  }
  return out;
}

/** Why the spec cannot be built (first problem), or null. */
export function joineryProblem(spec: JoinerySpec): string | null {
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (!positive(spec.width) || !positive(spec.height)) return 'Width and height must be positive';
  if (!positive(spec.frame.depth) || !positive(spec.frame.width)) return 'The frame needs a positive depth and width';
  if (spec.columns.length < 1 || spec.rows.length < 1 || spec.columns.length > 12 || spec.rows.length > 12) return 'Use 1 to 12 columns and rows';
  if (![...spec.columns, ...spec.rows].every(positive)) return 'Column widths and row heights must be positive';
  const { cols, rows } = gridExtents(spec);
  const minCell = 0.05;
  if (cols.some(([a, b]) => b - a < minCell) || rows.some(([a, b]) => b - a < minCell)) return 'The frame, mullions and transoms leave no room for the panels';
  for (const p of normalisedPanels(spec)) {
    const r = panelRect(spec, p);
    if (p.operation !== 'fixed' && !isDoorLeaf(p.operation) && (r.x1 - r.x0 < 2 * spec.sash.width + minCell || r.z1 - r.z0 < 2 * spec.sash.width + minCell)) {
      return 'A sash is too small for its profile: widen the panel or slim the sash';
    }
  }
  return null;
}
