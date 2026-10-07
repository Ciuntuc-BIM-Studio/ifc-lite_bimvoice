/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Read-out quantities of a drafted shape (metres, square metres, degrees). */

import { signedArea } from './offset';
import { dist, sweepOf } from './vec';
import type { DraftShape } from './types';

export interface ShapeMeasure {
  length: number;
  area?: number;
  radius?: number;
  angleDeg?: number;
}

export function measureShape(shape: DraftShape): ShapeMeasure {
  switch (shape.type) {
    case 'line':
      return { length: dist(shape.a, shape.b) };
    case 'polyline': {
      let length = 0;
      for (let i = 1; i < shape.pts.length; i++) length += dist(shape.pts[i - 1], shape.pts[i]);
      if (shape.closed && shape.pts.length > 2) {
        length += dist(shape.pts[shape.pts.length - 1], shape.pts[0]);
        return { length, area: Math.abs(signedArea(shape.pts)) };
      }
      return { length };
    }
    case 'circle':
      return { length: 2 * Math.PI * shape.r, area: Math.PI * shape.r * shape.r, radius: shape.r };
    case 'arc': {
      const sweep = sweepOf(shape.start, shape.end);
      return { length: sweep * shape.r, radius: shape.r, angleDeg: (sweep * 180) / Math.PI };
    }
  }
}

/** Parse a typed parameter value: number, boolean, else text. */
export function parseParamValue(text: string): string | number | boolean {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  return text;
}
