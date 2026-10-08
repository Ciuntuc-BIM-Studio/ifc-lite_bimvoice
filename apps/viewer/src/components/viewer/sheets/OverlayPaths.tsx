/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A plan's overlays (`project/plan-overlays.ts`) as SVG: one tagged path per pen, labels as text. */

import type { PlanOverlay } from '@/project/plan-overlays';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { shapePath } from '../drafting/DraftOverlay';
import { penTags } from './dxf-tags';

/** Label size, paper millimetres. */
const LABEL_MM = 2.5;

export function OverlayPaths({ overlays, transform, axis, textScale = 1 }: {
  overlays: readonly PlanOverlay[]; transform: ViewTransform; axis: SectionAxisName;
  /** Paper millimetres → the SVG's units for labels (1 on a sheet). */
  textScale?: number;
}) {
  return (
    <>
      {overlays.map((o, i) => (
        <g key={i} {...penTags(o.layer, o.width, !!o.dashed)}>
          <path d={o.shapes.map((s) => shapePath(s, transform, axis)).join('')} stroke="#000" strokeWidth={o.width * textScale} strokeDasharray={o.dashed ? `${3 * textScale} ${1.5 * textScale}` : undefined} fill="none" />
          {o.texts?.map((l, k) => {
            const p = drawingToScreen(l.at, transform, axis);
            return <text key={k} x={p.x} y={p.y} fontSize={LABEL_MM * textScale} textAnchor="middle" dominantBaseline="middle" fill="#000" stroke="none" fontFamily="sans-serif">{l.text}</text>;
          })}
        </g>
      ))}
    </>
  );
}
