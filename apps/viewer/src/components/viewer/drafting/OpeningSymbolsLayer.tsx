/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Door swings and window glazing on a floor plan tab (`drafting/opening-symbols.ts`),
 * drawn over the generated drawing in its ink.
 */

import { memo, useMemo } from 'react';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import type { SectionAxisName, ViewTransform } from '@/drafting/frame';
import { useProjectStore } from '@/project/project-store';
import { viewOpeningSymbols } from '@/project/view-symbols';
import type { DraftShape } from '@/drafting/types';
import { shapePath } from './DraftOverlay';

interface Props {
  /** The plan's cut plane (world units); nothing is drawn for other views. */
  plane: SectionPlaneConfig | null;
  /** Upper-case IFC classes the view hides (`hiddenClasses`). */
  hidden: ReadonlySet<string>;
  transform: ViewTransform;
  axis: SectionAxisName;
}

export const OpeningSymbolsLayer = memo(function OpeningSymbolsLayer({ plane, hidden, transform, axis }: Props) {
  const { geometryResult } = useDrawingRuntime();
  const flips = useProjectStore((s) => s.symbolFlips);
  const symbols = useMemo(
    () => (plane && geometryResult?.meshes ? viewOpeningSymbols(geometryResult.meshes, plane, flips, hidden) : []),
    [plane, geometryResult, flips, hidden],
  );
  if (symbols.length === 0) return null;
  const path = (shapes: DraftShape[]) => shapes.map((s) => shapePath(s, transform, axis)).join('');
  const thin = path(symbols.flatMap((s) => s.shapes));
  const heavy = path(symbols.flatMap((s) => s.heavy ?? []));
  const dashed = path(symbols.flatMap((s) => s.dashed ?? []));
  return (
    <svg data-opening-symbols className="absolute inset-0 h-full w-full pointer-events-none text-zinc-800 dark:text-zinc-200" aria-hidden="true">
      <path d={thin} fill="none" stroke="currentColor" strokeWidth={0.75} />
      {heavy ? <path d={heavy} fill="none" stroke="currentColor" strokeWidth={1.4} /> : null}
      {dashed ? <path d={dashed} fill="none" stroke="currentColor" strokeWidth={0.75} strokeDasharray="4 3" /> : null}
    </svg>
  );
});
