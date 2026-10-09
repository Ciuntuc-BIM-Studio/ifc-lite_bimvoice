/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The view's membrane lines (vapour barriers, foils, layers under 2 mm): a heavy dashed line where each lies. */

import { memo } from 'react';
import type { SectionAxisName, ViewTransform } from '@/drafting/frame';
import type { DraftShape } from '@/drafting/types';
import { shapePath } from './DraftOverlay';

export const MembraneLayer = memo(function MembraneLayer({ shapes, transform, axis }: { shapes: readonly DraftShape[] | undefined; transform: ViewTransform; axis: SectionAxisName }) {
  if (!shapes?.length) return null;
  return (
    <svg data-membranes className="absolute inset-0 h-full w-full pointer-events-none text-zinc-900 dark:text-zinc-100" aria-hidden="true">
      <path d={shapes.map((s) => shapePath(s, transform, axis)).join('')} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" strokeLinecap="butt" />
    </svg>
  );
});
