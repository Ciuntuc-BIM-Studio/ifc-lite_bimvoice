/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading the drafting standards of a project file — text styles, dimension
 * styles, layer groups — tolerantly: a malformed field falls back to the
 * standard style's, an unreadable entry is dropped, and the Standard styles
 * are always there.
 */

import {
  DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE, STANDARD,
  type ArrowKind, type DimStyle, type FontKind, type LayerGroup, type LengthUnit, type TextPlacement, type TextStyle,
} from '@/drafting/styles';

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? { color: v } : {});

function readText(v: Raw): TextStyle {
  const d = DEFAULT_TEXT_STYLE;
  return {
    id: str(v.id, d.id), name: str(v.name, d.name), height: num(v.height, d.height) || d.height,
    font: oneOf<FontKind>(v.font, ['sans', 'serif', 'mono'], d.font), bold: v.bold === true, italic: v.italic === true, ...color(v.color),
  };
}

function readDim(v: Raw): DimStyle {
  const d = DEFAULT_DIM_STYLE;
  return {
    id: str(v.id, d.id), name: str(v.name, d.name), textStyle: str(v.textStyle, d.textStyle),
    arrow: oneOf<ArrowKind>(v.arrow, ['tick', 'arrow', 'dot', 'none'], d.arrow), arrowSize: num(v.arrowSize, d.arrowSize),
    extGap: num(v.extGap, d.extGap), extOver: num(v.extOver, d.extOver),
    placement: oneOf<TextPlacement>(v.placement, ['above', 'centered', 'below'], d.placement), textGap: num(v.textGap, d.textGap),
    precision: Math.round(num(v.precision, d.precision)), unit: oneOf<LengthUnit>(v.unit, ['m', 'cm', 'mm'], d.unit), ...color(v.color),
  };
}

function withStandard<T extends { id: string }>(list: T[], standard: T): T[] {
  return list.some((s) => s.id === STANDARD) ? list : [{ ...standard }, ...list];
}

export function readStandards(raw: Raw): { textStyles: TextStyle[]; dimStyles: DimStyle[]; layerGroups: LayerGroup[] } {
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter(isObject) : []);
  return {
    textStyles: withStandard(list('textStyles').map(readText), DEFAULT_TEXT_STYLE),
    dimStyles: withStandard(list('dimStyles').map(readDim), DEFAULT_DIM_STYLE),
    layerGroups: list('layerGroups').filter((g) => typeof g.id === 'string').map((g) => ({
      id: g.id as string, name: str(g.name, 'Group'), visible: g.visible !== false, locked: g.locked === true,
    })),
  };
}
