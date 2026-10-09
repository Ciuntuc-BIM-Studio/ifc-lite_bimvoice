/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A fixed-size preview that can be zoomed (wheel, about the cursor) and
 * panned (drag), and fitted back with a double click — the 2D canvas
 * behaviour, for the configurators' small drawings.
 */

import { useMemo, useRef, type ReactNode } from 'react';
import { usePanZoom } from '@/lib/use-pan-zoom';

export function ZoomBox({ width, height, label, children }: { width: number; height: number; label: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const size = useMemo(() => ({ width, height }), [width, height]);
  const { view, handlers } = usePanZoom(host, size, 0);
  return (
    <div ref={host} aria-label={label} className="relative cursor-grab touch-none overflow-hidden outline-none active:cursor-grabbing" style={{ width, height }} {...handlers}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {children}
      </div>
    </div>
  );
}
