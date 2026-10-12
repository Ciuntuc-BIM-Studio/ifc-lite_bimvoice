/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The section marks on a floor plan on screen (`project/section-marks.ts`): chain line, heavy ends, arrows, names. */

import { memo, useMemo } from 'react';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { useProjectStore } from '@/project/project-store';
import { sectionMarkOverlays } from '@/project/section-marks';
import type { ProjectView } from '@/project/types';

interface Props {
  view: ProjectView;
  plane: SectionPlaneConfig | null;
  transform: ViewTransform;
  axis: SectionAxisName;
}

export const SectionMarksLayer = memo(function SectionMarksLayer({ view, plane, transform, axis }: Props) {
  const views = useProjectStore((s) => s.views);
  const overlays = useMemo(() => (plane ? sectionMarkOverlays(view, plane, views) : []), [view, plane, views]);
  if (!overlays.length) return null;
  const S = (p: Pt) => drawingToScreen(p, transform, axis);
  return (
    <svg data-section-marks className="absolute inset-0 h-full w-full pointer-events-none text-zinc-800 dark:text-zinc-200" aria-hidden="true">
      {overlays.map((o, i) => (
        <g key={i} stroke="currentColor" fill="none" strokeWidth={o.width >= 0.5 ? 2.4 : o.width >= 0.35 ? 1.3 : 0.8} strokeDasharray={o.dashed ? '10 3 2 3' : undefined}>
          {o.shapes.map((s, j) => (s.type === 'line' ? <path key={j} d={`M${S(s.a).x.toFixed(1)},${S(s.a).y.toFixed(1)}L${S(s.b).x.toFixed(1)},${S(s.b).y.toFixed(1)}`} /> : null))}
          {o.texts?.map((t, j) => (
            <text key={`t${j}`} x={S(t.at).x} y={S(t.at).y} fontSize={12} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill="currentColor" stroke="none">{t.text}</text>
          ))}
        </g>
      ))}
    </svg>
  );
});
