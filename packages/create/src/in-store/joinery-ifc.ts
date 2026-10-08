/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A joinery spec in IFC terms: the type's PartitioningType (window) or
 * OperationType (door), and per panel the IfcWindowPanelProperties /
 * IfcDoorPanelProperties enumerations. IFC's "left hand" / "right hand" name
 * the hinge side seen from the interior, the spec's convention too.
 */

import { gridExtents, isDoorLeaf, normalisedPanels, panelRect, type JoineryPanel, type JoinerySpec, type PanelOperation } from './joinery-spec.js';

const WINDOW_PANEL_OPERATION: Readonly<Partial<Record<PanelOperation, string>>> = {
  'fixed': 'FIXEDCASEMENT',
  'side-left': 'SIDEHUNGLEFTHAND',
  'side-right': 'SIDEHUNGRIGHTHAND',
  'tilt-turn-left': 'TILTANDTURNLEFTHAND',
  'tilt-turn-right': 'TILTANDTURNRIGHTHAND',
  'bottom-hung': 'BOTTOMHUNG',
  'top-hung': 'TOPHUNG',
  'pivot-horizontal': 'PIVOTHORIZONTAL',
  'pivot-vertical': 'PIVOTVERTICAL',
  'sliding-left': 'SLIDINGHORIZONTAL',
  'sliding-right': 'SLIDINGHORIZONTAL',
  'sliding-vertical': 'SLIDINGVERTICAL',
};

const DOOR_PANEL_OPERATION: Readonly<Partial<Record<PanelOperation, string>>> = {
  'swing-left': 'SWINGING',
  'swing-right': 'SWINGING',
  'double-acting-left': 'DOUBLE_ACTING',
  'double-acting-right': 'DOUBLE_ACTING',
  'door-sliding-left': 'SLIDING',
  'door-sliding-right': 'SLIDING',
  'folding-left': 'FOLDING',
  'folding-right': 'FOLDING',
  'fixed': 'FIXEDPANEL',
};

/** IfcWindowPanelOperationEnum value of a panel (a door leaf in a window has none: OTHEROPERATION). */
export function windowPanelOperation(op: PanelOperation): string {
  return WINDOW_PANEL_OPERATION[op] ?? 'OTHEROPERATION';
}

/** IfcDoorPanelOperationEnum value of a panel (glazing beside a leaf is a fixed panel). */
export function doorPanelOperation(op: PanelOperation): string {
  return DOOR_PANEL_OPERATION[op] ?? 'FIXEDPANEL';
}

/** LEFT / MIDDLE / RIGHT by column, or BOTTOM / TOP in a one-column, several-row grid. */
export function panelPosition(spec: JoinerySpec, panel: JoineryPanel, kind: 'door' | 'window'): string {
  const nc = spec.columns.length, nr = spec.rows.length;
  const last = panel.col + (panel.colSpan ?? 1) - 1;
  if (nc > 1) {
    if (panel.col === 0 && last < nc - 1) return 'LEFT';
    if (last === nc - 1 && panel.col > 0) return 'RIGHT';
    return 'MIDDLE';
  }
  if (kind === 'window' && nr > 1) {
    const top = panel.row + (panel.rowSpan ?? 1) - 1;
    if (panel.row === 0 && top < nr - 1) return 'BOTTOM';
    if (top === nr - 1 && panel.row > 0) return 'TOP';
  }
  return 'MIDDLE';
}

/** IfcWindowTypePartitioningEnum from the grid's shape; anything richer is USERDEFINED. */
export function windowPartitioning(spec: JoinerySpec): { type: string; userDefined?: string } {
  const panels = normalisedPanels(spec);
  const nc = spec.columns.length, nr = spec.rows.length;
  const grid = `${nc}x${nr} grid, ${panels.length} panels`;
  if (panels.length === 1) return { type: 'SINGLE_PANEL' };
  if (nr === 1) return nc === 2 ? { type: 'DOUBLE_PANEL_VERTICAL' } : nc === 3 ? { type: 'TRIPLE_PANEL_VERTICAL' } : { type: 'USERDEFINED', userDefined: grid };
  if (nc === 1) return nr === 2 ? { type: 'DOUBLE_PANEL_HORIZONTAL' } : nr === 3 ? { type: 'TRIPLE_PANEL_HORIZONTAL' } : { type: 'USERDEFINED', userDefined: grid };
  if (nc === 2 && nr === 2 && panels.length === 3) {
    const full = panels.find((p) => (p.colSpan ?? 1) === 2);
    if (full) return { type: full.row === 1 ? 'TRIPLE_PANEL_TOP' : 'TRIPLE_PANEL_BOTTOM' };
    const tall = panels.find((p) => (p.rowSpan ?? 1) === 2);
    if (tall) return { type: tall.col === 0 ? 'TRIPLE_PANEL_LEFT' : 'TRIPLE_PANEL_RIGHT' };
  }
  return { type: 'USERDEFINED', userDefined: grid };
}

/** IfcDoorTypeOperationEnum from the leaves; leaves with fixed glazing beside them are SWING_FIXED_*. */
export function doorOperation(spec: JoinerySpec): { type: string; userDefined?: string } {
  const leaves = normalisedPanels(spec).filter((p) => isDoorLeaf(p.operation)).sort((a, b) => a.col - b.col);
  const ops = leaves.map((p) => p.operation);
  const fixedBeside = normalisedPanels(spec).some((p) => p.operation === 'fixed' && (p.rowSpan ?? 1) === spec.rows.length);
  if (ops.length === 1) {
    const [op] = ops;
    if (op === 'swing-left') return { type: fixedBeside ? 'SWING_FIXED_LEFT' : 'SINGLE_SWING_LEFT' };
    if (op === 'swing-right') return { type: fixedBeside ? 'SWING_FIXED_RIGHT' : 'SINGLE_SWING_RIGHT' };
    if (op === 'double-acting-left') return { type: 'DOUBLE_SWING_LEFT' };
    if (op === 'double-acting-right') return { type: 'DOUBLE_SWING_RIGHT' };
    if (op === 'door-sliding-left') return { type: 'SLIDING_TO_LEFT' };
    if (op === 'door-sliding-right') return { type: 'SLIDING_TO_RIGHT' };
    if (op === 'folding-left') return { type: 'FOLDING_TO_LEFT' };
    if (op === 'folding-right') return { type: 'FOLDING_TO_RIGHT' };
  }
  if (ops.length === 2) {
    const [a, b] = ops;
    if (a === 'swing-left' && b === 'swing-right') return { type: 'DOUBLE_DOOR_SINGLE_SWING' };
    if (a === 'swing-left' && b === 'swing-left') return { type: 'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT' };
    if (a === 'swing-right' && b === 'swing-right') return { type: 'DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT' };
    if (a === 'double-acting-left' && b === 'double-acting-right') return { type: 'DOUBLE_DOOR_DOUBLE_SWING' };
    if (a.startsWith('door-sliding') && b.startsWith('door-sliding')) return { type: 'DOUBLE_DOOR_SLIDING' };
    if (a.startsWith('folding') && b.startsWith('folding')) return { type: 'DOUBLE_DOOR_FOLDING' };
  }
  return { type: 'USERDEFINED', userDefined: ops.join(' + ') || 'fixed' };
}

/** Mullion / transom offsets as ratios of the overall width / height (IfcWindowLiningProperties). */
export function liningOffsets(spec: JoinerySpec): { mullions: number[]; transoms: number[] } {
  const { cols, rows } = gridExtents(spec);
  const mullions = cols.slice(0, -1).map(([, x1]) => (x1 + spec.frame.mullion / 2 + spec.width / 2) / spec.width);
  const transoms = rows.slice(0, -1).map(([, z1]) => (z1 + spec.frame.transom / 2) / spec.height);
  return { mullions, transoms };
}

/** A door leaf's width as a ratio of the overall width (IfcDoorPanelProperties.PanelWidth). */
export function panelWidthRatio(spec: JoinerySpec, panel: JoineryPanel): number {
  const r = panelRect(spec, panel);
  return Math.min(1, Math.max(0, (r.x1 - r.x0) / spec.width));
}
