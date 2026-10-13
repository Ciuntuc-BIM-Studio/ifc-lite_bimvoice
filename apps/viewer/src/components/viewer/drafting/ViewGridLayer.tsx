/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The BIM grids on a floor plan on screen, in the project's default axis type (`project/view-grids.ts`). */

import { memo } from 'react';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { SectionAxisName, ViewTransform } from '@/drafting/frame';
import { useViewGridAxes } from '@/project/view-grids';
import type { ProjectView } from '@/project/types';
import { AnnotationGraphics } from './AnnotationGraphics';

interface Props {
  view: ProjectView;
  plane: SectionPlaneConfig | null;
  transform: ViewTransform;
  axis: SectionAxisName;
}

const INK = '#18181b';

export const ViewGridLayer = memo(function ViewGridLayer({ view, plane, transform, axis }: Props) {
  const grids = useViewGridAxes(view, plane);
  if (!grids.axes.length) return null;
  return (
    <svg data-view-grids className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
      {grids.axes.map((shape, i) => (
        <AnnotationGraphics key={i} shape={shape} color={INK} selected={false} transform={transform} axis={axis}
          extraPatterns={[]} look={grids.look} paperUnit={(view.scale ?? 100) / 1000} />
      ))}
    </svg>
  );
});
