/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Rigid and similarity transforms of drafting shapes. Pure: inputs are never mutated. */

import type { DraftShape, Pt } from './types';
import { add, angleOf, mirrorPt, normAngle, rotatePt, sub } from './vec';

function mapPts(shape: DraftShape, f: (p: Pt) => Pt): DraftShape {
  switch (shape.type) {
    case 'line':
      return { type: 'line', a: f(shape.a), b: f(shape.b) };
    case 'polyline':
      return { type: 'polyline', pts: shape.pts.map(f), closed: shape.closed };
    case 'circle':
      return { type: 'circle', c: f(shape.c), r: shape.r };
    case 'arc':
      return { type: 'arc', c: f(shape.c), r: shape.r, start: shape.start, end: shape.end };
  }
}

export function translateShape(s: DraftShape, d: Pt): DraftShape {
  return mapPts(s, (p) => add(p, d));
}

export function rotateShape(s: DraftShape, center: Pt, angle: number): DraftShape {
  const out = mapPts(s, (p) => rotatePt(p, center, angle));
  if (out.type === 'arc') {
    out.start = normAngle(out.start + angle);
    out.end = normAngle(out.end + angle);
  }
  return out;
}

/**
 * Reflect across the line a-b. A reflection reverses orientation, so an
 * arc's mirrored end becomes its new CCW start (and vice versa): the
 * resulting arc covers exactly the mirrored point set.
 */
export function mirrorShape(s: DraftShape, a: Pt, b: Pt): DraftShape {
  const out = mapPts(s, (p) => mirrorPt(p, a, b));
  if (s.type === 'arc' && out.type === 'arc') {
    const phi = angleOf(sub(b, a));
    out.start = normAngle(2 * phi - s.end);
    out.end = normAngle(2 * phi - s.start);
  }
  return out;
}

/** Uniform scale about `center` by k (k > 0; non-positive k returns a copy). */
export function scaleShape(s: DraftShape, center: Pt, k: number): DraftShape {
  const f = k > 0 ? k : 1;
  const out = mapPts(s, (p) => ({ x: center.x + (p.x - center.x) * f, y: center.y + (p.y - center.y) * f }));
  if (out.type === 'circle' || out.type === 'arc') out.r *= f;
  return out;
}
