/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import { findPattern } from '@/drafting/hatch/library';
import { hatchSegments } from '@/drafting/hatch/fill';
import { HATCH_UNIT_M } from '@/drafting/annotation';
import type { HatchPattern } from '@/drafting/hatch/pattern';

/** A small square of a material's hatch on its fill, as it prints. */
export function MaterialSwatch({ pattern, scale, fill, membrane, extra }: { pattern: string | null | undefined; scale: number; fill: string | null | undefined; membrane?: boolean; extra: readonly HatchPattern[] }) {
  const size = 34;
  const lines = useMemo(() => {
    const p = pattern ? findPattern(pattern, extra) : undefined;
    if (!p || p.solid) return { solid: !!p?.solid, d: '' };
    // 1.5 m of drawing, hatched as a plan hatches it.
    const m = 1.5;
    const box = [{ x: 0, y: 0 }, { x: m, y: 0 }, { x: m, y: m }, { x: 0, y: m }];
    const segs = hatchSegments([box], p, { scale: scale * HATCH_UNIT_M, angleDeg: 0, maxSegments: 2000 }).segments;
    const k = size / m;
    return { solid: false, d: segs.map((s) => `M${(s.a.x * k).toFixed(1)} ${(size - s.a.y * k).toFixed(1)}L${(s.b.x * k).toFixed(1)} ${(size - s.b.y * k).toFixed(1)}`).join('') };
  }, [pattern, scale, extra]);
  return (
    <svg width={size} height={size / 2} viewBox={`0 ${size / 4} ${size} ${size / 2}`} aria-hidden="true" className="rounded-sm border border-zinc-300 bg-white dark:border-zinc-600">
      <rect x={0} y={0} width={size} height={size} fill={lines.solid ? '#000' : fill ?? '#fff'} />
      {membrane ? <line x1={2} x2={size - 2} y1={size / 2} y2={size / 2} stroke="#000" strokeWidth={2} strokeDasharray="5 3" /> : <path d={lines.d} stroke="#000" strokeWidth={0.6} fill="none" />}
    </svg>
  );
}
