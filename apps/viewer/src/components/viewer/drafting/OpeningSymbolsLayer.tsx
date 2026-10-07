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
import { openingSymbols } from '@/drafting/opening-symbols';
import type { SectionAxisName, ViewTransform } from '@/drafting/frame';
import { useProjectStore } from '@/project/project-store';
import { renderIdGlobalId } from '@/project/element-guid';
import { shapePath } from './DraftOverlay';

interface Props {
  /** The plan's cut plane (world units); nothing is drawn for other views. */
  plane: SectionPlaneConfig | null;
  transform: ViewTransform;
  axis: SectionAxisName;
}

export const OpeningSymbolsLayer = memo(function OpeningSymbolsLayer({ plane, transform, axis }: Props) {
  const { geometryResult } = useDrawingRuntime();
  const flips = useProjectStore((s) => s.symbolFlips);
  const symbols = useMemo(() => {
    if (!plane || !geometryResult?.meshes) return [];
    const flipsOf = (id: number) => {
      const guid = flips && Object.keys(flips).length > 0 ? renderIdGlobalId(id) : null;
      return guid ? flips?.[guid] ?? 0 : 0;
    };
    return openingSymbols(geometryResult.meshes, plane, flipsOf);
  }, [plane, geometryResult, flips]);
  if (symbols.length === 0) return null;
  const d = symbols.flatMap((s) => s.shapes).map((s) => shapePath(s, transform, axis)).join('');
  return (
    <svg data-opening-symbols className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={0.75} className="text-zinc-800 dark:text-zinc-200" />
    </svg>
  );
});
