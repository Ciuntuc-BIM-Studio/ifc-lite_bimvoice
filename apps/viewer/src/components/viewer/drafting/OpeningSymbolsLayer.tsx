/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Door swings and window glazing on a floor plan tab (`drafting/opening-symbols.ts`),
 * and the opening marks of typed or mapped doors and windows on an elevation
 * or section tab, drawn over the generated drawing in its ink.
 */

import { memo, useMemo } from 'react';
import type { Drawing2D, SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import type { SectionAxisName, ViewTransform } from '@/drafting/frame';
import { useProjectStore } from '@/project/project-store';
import { viewElevationSymbols, viewOpeningSymbols, visibleEntities } from '@/project/view-symbols';
import type { DraftShape } from '@/drafting/types';
import { shapePath } from './DraftOverlay';

interface Props {
  /** The view's plane (world units); null draws nothing. */
  plane: SectionPlaneConfig | null;
  /** An elevation's / section's drawing: its symbols go on the doors and windows it shows. */
  drawing?: Drawing2D | null;
  /** Upper-case IFC classes the view hides (`hiddenClasses`). */
  hidden: ReadonlySet<string>;
  transform: ViewTransform;
  axis: SectionAxisName;
}

export const OpeningSymbolsLayer = memo(function OpeningSymbolsLayer({ plane, drawing, hidden, transform, axis }: Props) {
  const { geometryResult } = useDrawingRuntime();
  const flips = useProjectStore((s) => s.symbolFlips);
  // Symbols follow the catalogue and the symbol mapping too.
  const catalogue = useProjectStore((s) => s.joineryTypes);
  const mapping = useProjectStore((s) => s.joineryMapping);
  const symbols = useMemo(
    () => {
      if (!plane || !geometryResult?.meshes) return [];
      if (plane.axis === 'y') return viewOpeningSymbols(geometryResult.meshes, plane, flips, hidden);
      return drawing ? viewElevationSymbols(geometryResult.meshes, plane, visibleEntities(drawing), hidden) : [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogue / mapping are read through the project store
    [plane, drawing, geometryResult, flips, hidden, catalogue, mapping],
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
