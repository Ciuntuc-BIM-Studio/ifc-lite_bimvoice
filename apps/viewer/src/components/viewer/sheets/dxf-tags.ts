/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What an exported SVG element says about its DXF layer: the layer name,
 * the layer's own colour, pen weight (mm) and line type. The DXF walker
 * (`sheet-dxf.ts`) reads the nearest tagged ancestor, so a drafted entity
 * lands on its drafting layer — colour, weight and line type included — and
 * the model drawing on CUT / SEEN / HIDDEN / HATCH / SYMBOLS with its pens.
 */

import type { DraftLayer } from '@/drafting/types';

export type DxfTags = Record<`data-dxf-${'layer' | 'color' | 'lw' | 'ltype'}`, string | undefined>;

/** A drafting layer's tags. */
export function layerTags(layer: DraftLayer | undefined): DxfTags {
  return {
    'data-dxf-layer': layer?.name ?? '0',
    'data-dxf-color': layer?.color ?? '#000000',
    'data-dxf-lw': String(layer?.lineWeight ?? 0.25),
    'data-dxf-ltype': layer?.lineType ?? 'continuous',
  };
}

/** A role layer's tags (the generated drawing's pens). */
export function penTags(layer: string, widthMm: number, dashed = false, color = '#000000'): DxfTags {
  return { 'data-dxf-layer': layer, 'data-dxf-color': color, 'data-dxf-lw': String(widthMm), 'data-dxf-ltype': dashed ? 'dashed' : 'continuous' };
}
