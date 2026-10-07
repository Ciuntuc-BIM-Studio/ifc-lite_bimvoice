/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The view's category cut hatches (`project/view-graphics.ts` `cutHatches`):
 * CAD patterns from the hatch library over the cut faces of each category
 * that names one, clipped to each face.
 */

import { memo, useId, useMemo } from 'react';
import { findPattern } from '@/drafting/hatch/library';
import { hatchSegments } from '@/drafting/hatch/fill';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import { HATCH_UNIT_M } from '@/drafting/annotation';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import type { CutHatch } from '@/project/view-graphics';
import { shapePath } from './DraftOverlay';

interface Props {
  hatches: readonly CutHatch[];
  extraPatterns: readonly HatchPattern[];
  transform: ViewTransform;
  axis: SectionAxisName;
}

export const CutHatchLayer = memo(function CutHatchLayer({ hatches, extraPatterns, transform, axis }: Props) {
  const uid = useId();
  // Pattern strokes in drawing space, once per hatch set; mapped to the screen per frame.
  const strokes = useMemo(() => hatches.map((h) => {
    const pattern = findPattern(h.pattern, extraPatterns);
    const segments = pattern && !pattern.solid ? hatchSegments(h.loops, pattern, { scale: h.scale * HATCH_UNIT_M, angleDeg: 0, maxSegments: 20000 }).segments : [];
    return { hatch: h, solid: !!pattern?.solid, segments };
  }), [hatches, extraPatterns]);
  if (strokes.length === 0) return null;
  return (
    <svg data-cut-hatches className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
      {strokes.map(({ hatch, solid, segments }, i) => {
        const outline = hatch.loops.map((l) => shapePath({ type: 'polyline', pts: l, closed: true }, transform, axis)).join('');
        if (solid) return <path key={i} d={outline} fill={hatch.color} fillOpacity={0.85} fillRule="evenodd" />;
        const d = segments.map((s) => {
          const a = drawingToScreen(s.a, transform, axis);
          const b = drawingToScreen(s.b, transform, axis);
          return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
        }).join('');
        return (
          <g key={i}>
            <clipPath id={`${uid}-cut-${i}`}><path d={outline} clipRule="evenodd" /></clipPath>
            <path d={d} stroke={hatch.color} strokeWidth={0.5} fill="none" clipPath={`url(#${uid}-cut-${i})`} />
          </g>
        );
      })}
    </svg>
  );
});
