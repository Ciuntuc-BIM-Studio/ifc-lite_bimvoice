/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pan and zoom for a 2D canvas showing content of a known size (paper
 * millimetres, drawing metres…), the way the sheets and drawing views
 * behave: the wheel zooms about the cursor, a drag (left on empty space,
 * or the middle button anywhere) pans, a double click or F / Home fits the
 * content, + and − zoom about the centre. The content is fitted when it
 * first appears and when its size changes.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface PanZoom {
  /** Screen pixels per content unit, and the content origin's screen position. */
  k: number;
  x: number;
  y: number;
}

const MIN = 0.02, MAX = 200;

export function usePanZoom(hostRef: RefObject<HTMLElement | null>, size: { width: number; height: number } | null, margin = 24) {
  const [view, setView] = useState<PanZoom>({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; start: PanZoom; pointer: number } | null>(null);

  const fit = useCallback(() => {
    const el = hostRef.current;
    if (!el || !size || size.width <= 0 || size.height <= 0) return;
    const { width, height } = el.getBoundingClientRect();
    const k = Math.min(Math.max((width - 2 * margin) / size.width, MIN), Math.max((height - 2 * margin) / size.height, MIN), MAX);
    setView({ k, x: (width - size.width * k) / 2, y: (height - size.height * k) / 2 });
  }, [hostRef, size?.width, size?.height, margin]);

  useLayoutEffect(() => { fit(); }, [fit]);

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setView((p) => {
      const k = Math.min(Math.max(p.k * factor, MIN), MAX);
      return { k, x: sx - (sx - p.x) * (k / p.k), y: sy - (sy - p.y) * (k / p.k) };
    });
  }, []);

  const zoomCentre = useCallback((factor: number) => {
    const el = hostRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    zoomAt(width / 2, height / 2, factor);
  }, [hostRef, zoomAt]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (!el.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (e.key === 'f' || e.key === 'F' || e.key === 'Home') { e.preventDefault(); fit(); }
      else if (e.key === '+' || e.key === '=') zoomCentre(1.25);
      else if (e.key === '-') zoomCentre(0.8);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [hostRef, zoomAt, zoomCentre, fit]);

  /** Spread on the host element. */
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { sx: e.clientX, sy: e.clientY, start: view, pointer: e.pointerId };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      setView({ ...d.start, x: d.start.x + e.clientX - d.sx, y: d.start.y + e.clientY - d.sy });
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (drag.current?.pointer === e.pointerId) drag.current = null;
    },
    onDoubleClick: () => fit(),
  };

  return { view, fit, zoomIn: () => zoomCentre(1.25), zoomOut: () => zoomCentre(0.8), handlers };
}
