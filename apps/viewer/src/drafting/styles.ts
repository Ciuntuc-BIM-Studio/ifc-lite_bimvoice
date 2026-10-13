/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drafting styles — the project's standards for annotation and linework:
 *
 *  - TEXT STYLES: paper height (mm), font, bold / italic, an optional colour.
 *  - DIMENSION STYLES: a text style, the arrow (tick, arrow, dot, none) and
 *    its size, extension-line gap and overshoot, where the value sits (above,
 *    centred on or below the line), its gap, precision and unit.
 *  - AXIS TYPES: how grid axes look — the bubble (circle / square), which
 *    ends carry it and its size, the line type, a colour, the text style of
 *    the label and the label new axes of the type start counting from.
 *  - TAG TYPES: what an element tag reads — a text template whose `{fields}`
 *    are mapped on the element's parameters (`{Name}`, `{Pset.Property}`…);
 *    a field the element lacks reads NaN, drawn in red.
 *  - LAYER GROUPS: layers gathered under a group that switches and locks
 *    them together.
 *
 * Sizes are PAPER millimetres; a view turns them into drawing units with
 * its scale (`paperUnit`: drawing units per paper millimetre — scale / 1000
 * on a view, 1 on a sheet).
 *
 * An entity names its style in `params.textStyle` / `params.dimStyle` /
 * `params.axisStyle` and
 * may override any field of it, element by element, in `params['o.<field>']`.
 * `resolveText` / `resolveDim` / `resolveAxis` give the style an entity is
 * drawn with.
 */

import type { AxisEnds, DraftLayer, DraftParamValue } from './types';

export type FontKind = 'sans' | 'serif' | 'mono';
export type TextPlacement = 'above' | 'centered' | 'below';
export type ArrowKind = 'tick' | 'arrow' | 'dot' | 'none';
export type LengthUnit = 'm' | 'cm' | 'mm';
export type LineType = 'continuous' | 'dashed' | 'dotted' | 'dashdot';

export interface TextStyle {
  id: string;
  name: string;
  /** Paper millimetres. */
  height: number;
  font: FontKind;
  bold: boolean;
  italic: boolean;
  /** CSS colour; absent = the entity's layer colour. */
  color?: string;
}

export interface DimStyle {
  id: string;
  name: string;
  textStyle: string;
  arrow: ArrowKind;
  /** Paper millimetres. */
  arrowSize: number;
  extGap: number;
  extOver: number;
  placement: TextPlacement;
  textGap: number;
  precision: number;
  unit: LengthUnit;
  color?: string;
}

export type AxisBubble = 'circle' | 'square';

export interface AxisStyle {
  id: string;
  name: string;
  textStyle: string;
  bubble: AxisBubble;
  ends: AxisEnds;
  /** The bubble's smallest diameter / side, paper millimetres. */
  size: number;
  lineType: LineType;
  /** CSS colour of the line and bubbles; absent = the entity's layer colour. */
  color?: string;
  /** The label the AXIS command starts from when the type is made current (1, A, A1…). */
  firstLabel: string;
}

export interface TagType {
  id: string;
  name: string;
  /** The text, `{field}` placeholders mapped on the element's parameters (`project/tag-fields.ts`). */
  template: string;
  /** IFC classes the type tags (`IfcWall`…); empty: any element. */
  classes: string[];
}

export interface LayerGroup {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export const STANDARD = 'standard';

export const DEFAULT_TEXT_STYLE: TextStyle = { id: STANDARD, name: 'Standard', height: 2.5, font: 'sans', bold: false, italic: false };

export const DEFAULT_DIM_STYLE: DimStyle = {
  id: STANDARD, name: 'Standard', textStyle: STANDARD, arrow: 'tick', arrowSize: 1.5, extGap: 1, extOver: 1.5,
  placement: 'above', textGap: 0.8, precision: 2, unit: 'm',
};

export const DEFAULT_AXIS_STYLE: AxisStyle = {
  id: STANDARD, name: 'Standard', textStyle: STANDARD, bubble: 'circle', ends: 'both', size: 10, lineType: 'dashdot', firstLabel: '1',
};

/** The fields an element may override, by kind. */
export const TEXT_OVERRIDES = ['height', 'font', 'bold', 'italic', 'color'] as const;
export const DIM_OVERRIDES = ['arrow', 'arrowSize', 'placement', 'textGap', 'precision', 'unit', 'color'] as const;
/** `color` is the text's (TEXT_OVERRIDES); an axis overrides its line colour as `lineColor`. */
export const AXIS_OVERRIDES = ['bubble', 'ends', 'size', 'lineType'] as const;

export const overrideKey = (field: string) => `o.${field}`;

export interface StyleBook {
  textStyles: readonly TextStyle[];
  dimStyles: readonly DimStyle[];
  /** Absent: Standard only. */
  axisStyles?: readonly AxisStyle[];
}

type Params = Record<string, DraftParamValue>;

function overridden<T extends object>(base: T, params: Params, fields: readonly string[]): T {
  const out = { ...base } as Record<string, unknown>;
  for (const field of fields) {
    const value = params[overrideKey(field)];
    if (value === undefined) continue;
    const current = out[field];
    if (typeof current === 'number' && typeof value === 'number') out[field] = value;
    else if (typeof current === 'boolean' && typeof value === 'boolean') out[field] = value;
    else if (typeof value === 'string') out[field] = value;
    else if (current === undefined) out[field] = value;
  }
  return out as T;
}

export function textStyleOf(book: StyleBook, id: unknown): TextStyle {
  return book.textStyles.find((s) => s.id === id) ?? book.textStyles.find((s) => s.id === STANDARD) ?? DEFAULT_TEXT_STYLE;
}

export function dimStyleOf(book: StyleBook, id: unknown): DimStyle {
  return book.dimStyles.find((s) => s.id === id) ?? book.dimStyles.find((s) => s.id === STANDARD) ?? DEFAULT_DIM_STYLE;
}

export function axisStyleOf(book: StyleBook, id: unknown): AxisStyle {
  const styles = book.axisStyles ?? [];
  return styles.find((s) => s.id === id) ?? styles.find((s) => s.id === STANDARD) ?? DEFAULT_AXIS_STYLE;
}

/** The text style an entity is drawn with: its style (or its dimension / axis style's), then its own overrides. */
export function resolveText(book: StyleBook, params: Params): TextStyle {
  const base = params.textStyle !== undefined ? textStyleOf(book, params.textStyle)
    : params.axisStyle !== undefined ? textStyleOf(book, axisStyleOf(book, params.axisStyle).textStyle)
      : textStyleOf(book, dimStyleOf(book, params.dimStyle).textStyle);
  return overridden(base, params, TEXT_OVERRIDES);
}

export function resolveDim(book: StyleBook, params: Params): DimStyle {
  return overridden(dimStyleOf(book, params.dimStyle), params, DIM_OVERRIDES);
}

export function resolveAxis(book: StyleBook, params: Params): AxisStyle {
  const style = overridden(axisStyleOf(book, params.axisStyle), params, AXIS_OVERRIDES);
  const lineColor = params[overrideKey('lineColor')];
  return typeof lineColor === 'string' ? { ...style, color: lineColor } : style;
}

/** Which fields of an entity are overridden (for "by style" / reset in the UI). */
export function overriddenFields(params: Params): string[] {
  return Object.keys(params).filter((k) => k.startsWith('o.')).map((k) => k.slice(2));
}

const FONTS: Record<FontKind, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, Menlo, monospace',
};

export const fontFamily = (font: FontKind) => FONTS[font] ?? FONTS.sans;

/** A length in a dimension style's unit and precision (the value is metres). */
export function formatDimension(metres: number, style: Pick<DimStyle, 'unit' | 'precision'>): string {
  const factor = style.unit === 'mm' ? 1000 : style.unit === 'cm' ? 100 : 1;
  return (metres * factor).toFixed(Math.max(0, Math.min(6, Math.round(style.precision))));
}

/**
 * Text reads left to right, and bottom to top when it runs vertically: a
 * screen angle (degrees, y down) folded into [−90°, 90°).
 */
export function readableDeg(deg: number): number {
  let d = ((deg % 360) + 540) % 360 - 180;
  if (d >= 90 - 1e-6) d -= 180;
  else if (d < -90 - 1e-6) d += 180;
  return d;
}

/** Dash pattern of a line type, paper millimetres (empty = continuous). */
export function dashOf(type: LineType | undefined): number[] {
  switch (type) {
    case 'dashed': return [3, 1.5];
    case 'dotted': return [0.3, 1];
    case 'dashdot': return [4, 1, 0.3, 1];
    default: return [];
  }
}

export interface LayerVisibilityScope {
  /** Layers the view in front hides (`ProjectView.hiddenLayers`). */
  view?: readonly string[];
  /** Layers a sheet viewport hides on top of its view (`SheetViewport.hiddenLayers`). */
  viewport?: readonly string[];
}

/** Text ranges `[start, end)` a tag could not fill (its NaNs), from `params.tagMissing` ("0:3,8:11"). */
export function missingRanges(params: Params): Array<[number, number]> {
  const raw = params.tagMissing;
  if (typeof raw !== 'string' || !raw) return [];
  return raw.split(',').flatMap((pair) => {
    const [a, b] = pair.split(':').map(Number);
    return Number.isInteger(a) && Number.isInteger(b) && b > a ? [[a, b] as [number, number]] : [];
  });
}

/** An entity's drawing styles, resolved, and the parts of its text a tag could not fill. */
export function lookOf(book: StyleBook, params: Params): { text: TextStyle; dim: DimStyle; axis: AxisStyle; missing?: Array<[number, number]> } {
  const missing = missingRanges(params);
  return { text: resolveText(book, params), dim: resolveDim(book, params), axis: resolveAxis(book, params), ...(missing.length ? { missing } : {}) };
}

/** A layer's pen: width and dash in paper millimetres. */
export function layerPen(layer: DraftLayer | undefined): { width: number; dash: number[] } {
  return { width: layer?.lineWeight ?? 0.25, dash: dashOf(layer?.lineType) };
}

/** Whether `layer` shows: its own switch, its group's, then the view's and the viewport's overrides. */
export function layerShows(layer: DraftLayer, groups: readonly LayerGroup[], scope: LayerVisibilityScope = {}): boolean {
  if (!layer.visible) return false;
  const group = layer.group ? groups.find((g) => g.id === layer.group) : undefined;
  if (group && !group.visible) return false;
  if (scope.view?.includes(layer.id)) return false;
  return !scope.viewport?.includes(layer.id);
}

/** Whether `layer` is locked, by itself or by its group. */
export function layerLocked(layer: DraftLayer, groups: readonly LayerGroup[]): boolean {
  return layer.locked || (layer.group ? groups.find((g) => g.id === layer.group)?.locked ?? false : false);
}
