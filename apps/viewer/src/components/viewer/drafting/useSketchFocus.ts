/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A Studio sketch opened for editing (`project/studio-feature.ts`): once its
 * view's drawing is up (and has had its own first fit), its contours are
 * selected and framed.
 */

import { useEffect, type RefObject } from 'react';
import { entityBounds } from '@/drafting/annotation';
import { screenSigns, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { setDraftSelection } from '@/drafting/session';
import type { DraftEntity } from '@/drafting/types';
import { useSketchFocus } from '@/project/studio-feature';

const MARGIN = 0.25;

/** The transform that frames `entities` in a `width` × `height` box. */
export function frameEntities(entities: readonly DraftEntity[], width: number, height: number, axis: SectionAxisName): ViewTransform | null {
  if (entities.length === 0) return null;
  const boxes = entities.map((e) => entityBounds(e.shape));
  const min = { x: Math.min(...boxes.map((b) => b.min.x)), y: Math.min(...boxes.map((b) => b.min.y)) };
  const max = { x: Math.max(...boxes.map((b) => b.max.x)), y: Math.max(...boxes.map((b) => b.max.y)) };
  const w = Math.max(max.x - min.x, 1e-3), h = Math.max(max.y - min.y, 1e-3);
  const scale = Math.min((width * (1 - 2 * MARGIN)) / w, (height * (1 - 2 * MARGIN)) / h);
  const { kx, ky } = screenSigns(axis);
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2;
  return { scale, x: width / 2 - cx * kx * scale, y: height / 2 - cy * ky * scale };
}

export function useSketchFocusFrame(
  viewId: string, axis: SectionAxisName, entities: readonly DraftEntity[], ready: boolean,
  containerRef: RefObject<HTMLDivElement | null>, setViewTransform: (t: ViewTransform) => void,
): void {
  const focus = useSketchFocus();
  useEffect(() => {
    if (focus.viewId !== viewId || !ready) return;
    // After the drawing's own first fit (an effect of the same render), not under it.
    const frame = requestAnimationFrame(() => {
      useSketchFocus.setState({ viewId: null, ids: [] });
      const ids = new Set(focus.ids);
      const sketch = entities.filter((e) => ids.has(e.id));
      setDraftSelection(new Set(sketch.map((e) => e.id)));
      const rect = containerRef.current?.getBoundingClientRect();
      const t = rect ? frameEntities(sketch, rect.width, rect.height, axis) : null;
      if (t) setViewTransform(t);
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, viewId, ready, entities, axis, containerRef, setViewTransform]);
}
